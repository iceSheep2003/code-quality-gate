import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  setupAgent,
  runWorkflow,
  runGate,
  validateTask,
} from "../src/index.mjs";
import { withWorkflowLock } from "../src/agent/lock.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const cli = resolve("src/cli.mjs");
const manifest = ".code-quality-gate/tasks/ADD.json";
const task = {
  version: 1,
  id: "ADD",
  title: "Add two numbers",
  requirements: ["Return the sum of two numbers"],
  testFiles: ["tests/contract.test.mjs"],
  codeFiles: ["business.mjs"],
  testChecks: ["acceptance"],
  protectedFiles: ["adapter.mjs"],
  maxAttempts: 3,
};
async function project(fn, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "code-quality-gate-agent-"));
  try {
    await mkdir(join(root, "tests"));
    await mkdir(join(root, ".code-quality-gate/tasks"), { recursive: true });
    await writeFile(
      join(root, manifest),
      JSON.stringify({ ...task, ...overrides }),
    );
    await writeFile(join(root, "business.mjs"), "export const add=(a,b)=>0;");
    await writeFile(join(root, "adapter.mjs"), "// protected test helper\n");
    await writeFile(
      join(root, "tests/contract.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {add} from '../business.mjs';test('adds two numbers',()=>assert.equal(add(2,3),5));",
    );
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({
        version: 1,
        audit: {
          checks: [
            {
              id: "acceptance",
              title: "Acceptance tests",
              command: [
                "node",
                "--test",
                "--test-reporter=junit",
                "--test-reporter-destination=tests.xml",
                "tests/contract.test.mjs",
              ],
              report: "tests.xml",
              format: "junit",
              metrics: [
                { name: "Success", path: "successRate", equals: 100 },
                { name: "Tests", path: "tests", min: 1 },
              ],
            },
          ],
        },
      }),
    );
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const phase = (root, value) => runWorkflow({ root, manifest, phase: value });
const fix = (root) =>
  writeFile(join(root, "business.mjs"), "export const add=(a,b)=>a+b;");
test("setup preserves user instructions/configuration and installs idempotent skills and MCP entry", async () => {
  await project(async (root) => {
    const config = await readFile(join(root, "quality.config.json"), "utf8");
    await writeFile(
      join(root, "AGENTS.md"),
      "User rules: never change unrelated code.\n",
    );
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: { existing: { command: "existing-tool" } },
      }),
    );
    assert.equal((await setupAgent(root)).passed, true);
    const first = await readFile(join(root, "AGENTS.md"), "utf8");
    await setupAgent(root);
    assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), first);
    assert.match(first, /^User rules: never change unrelated code\./);
    assert.equal(
      await readFile(join(root, "quality.config.json"), "utf8"),
      config,
    );
    const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers.existing.command, "existing-tool");
    assert.equal(mcp.mcpServers["code-quality-gate"].command, process.execPath);
    assert.equal(
      await readFile(
        join(root, ".agents/skills/code-quality-gate/SKILL.md"),
        "utf8",
      ),
      await readFile(
        join(root, ".claude/skills/code-quality-gate/SKILL.md"),
        "utf8",
      ),
    );
  });
});
test("setup refuses to overwrite a customized skill", async () => {
  await project(async (root) => {
    await mkdir(join(root, ".agents/skills/code-quality-gate"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".agents/skills/code-quality-gate/SKILL.md"),
      "My customized skill",
    );
    await assert.rejects(setupAgent(root), /customized skill/);
    assert.equal(
      await readFile(
        join(root, ".agents/skills/code-quality-gate/SKILL.md"),
        "utf8",
      ),
      "My customized skill",
    );
  });
});
test("real assertions establish red, failed green reports diagnostics, fixed green passes, final gate reruns tests", async () => {
  await project(async (root) => {
    const red = await phase(root, "red");
    assert.equal(red.passed, true, JSON.stringify(red));
    assert.equal(red.canMerge, false);
    assert.equal(red.audit.passed, false);
    assert.equal(red.audit.checks[0].metrics.assertionFailures, 1);
    const failed = await phase(root, "green");
    assert.equal(failed.passed, false);
    assert.notEqual(failed.report, red.report);
    await fix(root);
    const green = await phase(root, "green");
    assert.equal(green.passed, true, JSON.stringify(green));
    assert.equal(green.canMerge, false);
    const gate = await runGate({ root });
    assert.equal(gate.passed, true, JSON.stringify(gate));
    assert.equal(gate.canMerge, true);
    assert.match(
      await readFile(join(root, gate.report), "utf8"),
      /Ready to merge:\*\* yes/,
    );
    await writeFile(
      join(root, "business.mjs"),
      "export const add=(a,b)=>a+b; // edit after green",
    );
    assert.equal((await runGate({ root })).passed, false);
  });
});
test("initially green tests and module loading failures cannot establish red", async () => {
  await project(async (root) => {
    await fix(root);
    assert.equal((await phase(root, "red")).passed, false);
    await writeFile(
      join(root, "tests/contract.test.mjs"),
      "import './missing-module.mjs';",
    );
    assert.equal((await phase(root, "red")).passed, false);
    await assert.rejects(
      readFile(join(root, ".code-quality-gate/evidence/ADD.json")),
    );
  });
});
test("tests, adapters, requirement manifest and thresholds are frozen after red", async () => {
  for (const path of [
    "tests/contract.test.mjs",
    "adapter.mjs",
    manifest,
    "quality.config.json",
  ]) {
    await project(async (root) => {
      assert.equal((await phase(root, "red")).passed, true);
      const before = await readFile(join(root, path), "utf8");
      if (path.endsWith(".json"))
        await writeFile(join(root, path), before + "\n");
      else await writeFile(join(root, path), before + "\n// changed\n");
      await fix(root);
      const result = await phase(root, "green");
      assert.equal(result.passed, false, path);
      assert.match(result.message, /changed after red/);
    });
  }
});
test("missing red and missing green evidence block completion; red cannot be silently replaced", async () => {
  await project(async (root) => {
    assert.equal((await phase(root, "green")).passed, false);
    assert.equal((await runGate({ root })).passed, false);
    assert.equal((await phase(root, "red")).passed, true);
    const evidence = await readFile(
      join(root, ".code-quality-gate/evidence/ADD.json"),
      "utf8",
    );
    assert.equal((await phase(root, "red")).passed, false);
    assert.equal(
      await readFile(
        join(root, ".code-quality-gate/evidence/ADD.json"),
        "utf8",
      ),
      evidence,
    );
    assert.equal((await runGate({ root })).passed, false);
  });
});
test("attempt budget is enforced and old green cannot survive a failed rerun", async () => {
  await project(
    async (root) => {
      assert.equal((await phase(root, "red")).passed, true);
      assert.equal((await phase(root, "green")).passed, false);
      await fix(root);
      const exhausted = await phase(root, "green");
      assert.equal(exhausted.passed, false);
      assert.match(exhausted.message, /budget exhausted/);
    },
    { maxAttempts: 1 },
  );
  await project(async (root) => {
    await phase(root, "red");
    await fix(root);
    await phase(root, "green");
    await writeFile(join(root, "business.mjs"), "export const add=(a,b)=>-1;");
    assert.equal((await phase(root, "green")).passed, false);
    await fix(root);
    assert.equal((await runGate({ root })).passed, false);
  });
});
test("workflow refuses a check without structured required acceptance evidence", async () => {
  await project(async (root) => {
    const path = join(root, "quality.config.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    config.audit.checks[0].required = false;
    await writeFile(path, JSON.stringify(config));
    await assert.rejects(
      phase(root, "red"),
      /must be required and produce JUnit/,
    );
  });
});
test("same-project workflows cannot run concurrently and locks are released after exceptions", async () => {
  await project(async (root) => {
    await withWorkflowLock(root, async () => {
      await assert.rejects(phase(root, "red"), /Another workflow/);
    });
    await assert.rejects(
      withWorkflowLock(root, async () => {
        throw new Error("fixture error");
      }),
      /fixture error/,
    );
    assert.equal((await phase(root, "red")).passed, true);
  });
});
test("task validation rejects out-of-root paths, unbounded attempts and ambiguous contracts", () => {
  for (const change of [
    { ...task, id: "../escape" },
    { ...task, testFiles: ["../tests.py"] },
    { ...task, codeFiles: [task.testFiles[0]] },
    { ...task, codeFiles: ["src/*.py"] },
    { ...task, maxAttempts: 0 },
    { ...task, testChecks: [] },
    { ...task, requirements: [] },
  ])
    assert.throws(() => validateTask(change));
});
test("MCP stdio provides real discovery and the complete red/green/gate workflow", async () => {
  await project(async (root) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--root", root],
      stderr: "pipe",
    });
    const client = new Client({
      name: "code-quality-gate-integration-test",
      version: "1.0.0",
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.ok(
        listed.tools.some((tool) => tool.name === "code_quality_gate_gate"),
      );
      const call = async (name, args = {}) => {
        const result = await client.callTool(
          { name, arguments: args },
          undefined,
          { timeout: 30000 },
        );
        return JSON.parse(result.content[0].text);
      };
      assert.equal(
        (await call("code_quality_gate_status")).configuredChecks.length,
        1,
      );
      assert.equal(
        (await call("code_quality_gate_red", { manifest })).passed,
        true,
      );
      await fix(root);
      assert.equal(
        (await call("code_quality_gate_green", { manifest })).passed,
        true,
      );
      assert.equal((await call("code_quality_gate_gate")).canMerge, true);
      assert.equal(
        (await call("code_quality_gate_red", { manifest: "../escape" })).passed,
        false,
      );
    } finally {
      await client.close();
    }
  });
});
