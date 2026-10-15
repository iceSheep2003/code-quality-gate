import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
const runCli = (root, ...args) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
test("short commands retain test-first evidence, active configuration and final gate protection", async () => {
  await project(async (root) => {
    await writeFile(
      join(root, "custom.json"),
      await readFile(join(root, "quality.config.json")),
    );
    const missing = runCli(root, "green", "--json");
    assert.equal(missing.status, 2);
    assert.match(missing.stdout, /No active task/);
    const red = runCli(root, "red", "ADD", "-c", "custom.json", "--json");
    assert.equal(red.status, 0, red.stderr + red.stdout);
    assert.equal(JSON.parse(red.stdout).audit.passed, false);
    assert.equal(runCli(root, "green", "--json").status, 1);
    await fix(root);
    const green = runCli(root, "green", "-n", "Implement addition", "--json");
    assert.equal(green.status, 0, green.stderr + green.stdout);
    assert.equal(JSON.parse(green.stdout).canMerge, false);
    const gate = runCli(root, "gate", "--json");
    assert.equal(gate.status, 0, gate.stderr + gate.stdout);
    assert.equal(JSON.parse(gate.stdout).canMerge, true);
    const history = (
      await readFile(join(root, JSON.parse(gate.stdout).history.jsonl), "utf8")
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(history[2].note, "Implement addition");
    await writeFile(join(root, "business.mjs"), "export const add=(a,b)=>-1;");
    assert.equal(
      runCli(root, "gate", "ADD", "-c", "custom.json", "--json").status,
      1,
    );
  });
});
test("short workflow commands accept explicit manifest paths and keep legacy CLI compatibility", async () => {
  await project(async (root) => {
    const red = runCli(root, "red", manifest);
    assert.equal(red.status, 0, red.stderr + red.stdout);
    assert.match(red.stdout, /# /);
    await fix(root);
    const green = runCli(
      root,
      "workflow",
      "--change",
      manifest,
      "--phase",
      "green",
      "--json",
    );
    assert.equal(green.status, 0, green.stderr + green.stdout);
    assert.equal(runCli(root, "gate", "ADD", "--json").status, 0);
  });
});
test("short commands reject ambiguous tasks and retain root path confinement", async () => {
  await project(async (root) => {
    for (const args of [
      ["red"],
      ["red", "ADD", "--phase", "green"],
      ["red", "ADD", "--change", manifest],
      ["green", "ADD", "OTHER"],
      ["red", "../outside.json"],
    ]) {
      const result = runCli(root, ...args, "--json");
      assert.equal(result.status, 2, args.join(" ") + result.stdout);
    }
    const duplicateRoot = runCli(root, "mcp", root, "--root", root);
    assert.equal(duplicateRoot.status, 2);
    assert.match(duplicateRoot.stderr, /specified twice/);
  });
});
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
    const history = (await readFile(join(root, gate.history.jsonl), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(
      history.map((entry) => entry.phase),
      ["red", "green", "green", "gate"],
    );
    assert.equal(history[0].auditPassed, false);
    assert.equal(history[0].accepted, true);
    assert.equal(
      history[2].metrics.find((metric) => metric.path === "successRate").actual,
      100,
    );
    assert.equal(history[3].source.changedFiles.length, 0);
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
      args: [cli, "mcp"],
      cwd: root,
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
        (
          await call("code_quality_gate_green", {
            manifest,
            note: "Implement addition",
          })
        ).passed,
        true,
      );
      const gate = await call("code_quality_gate_gate");
      assert.equal(gate.canMerge, true);
      const history = (await readFile(join(root, gate.history.jsonl), "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse);
      assert.equal(history[1].note, "Implement addition");
      assert.equal(history.length, 3);
      assert.equal(
        (await call("code_quality_gate_red", { manifest: "../escape" })).passed,
        false,
      );
    } finally {
      await client.close();
    }
  });
});

test("MCP accepts a positional directory and short root flag from outside the project", async () => {
  await project(async (root) => {
    for (const args of [
      ["mcp", root],
      ["mcp", "-C", root],
    ]) {
      const client = new Client({
        name: "cqg-directory-test",
        version: "1.0.0",
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli, ...args],
        cwd: tmpdir(),
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: "code_quality_gate_status",
          arguments: {},
        });
        const status = JSON.parse(result.content[0].text);
        assert.equal(status.configuredChecks[0].id, "acceptance");
        assert.equal(status.active, null);
      } finally {
        await client.close();
      }
    }
  });
});

test("configured cross-check history columns survive a red run that only executes acceptance tests", async () => {
  await project(async (root) => {
    const path = join(root, "quality.config.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    config.audit.checks.push({
      id: "coverage",
      title: "Coverage",
      command: ["node", "-e", "process.exit(0)"],
      metrics: [],
    });
    config.audit.history = {
      metrics: [
        { check: "acceptance", path: "successRate", label: "Test success (%)" },
        { check: "coverage", path: "lines", label: "Line coverage (%)" },
      ],
    };
    await writeFile(path, JSON.stringify(config));
    const result = await phase(root, "red");
    assert.equal(result.passed, true);
    const entry = JSON.parse(
      (await readFile(join(root, result.history.jsonl), "utf8")).trim(),
    );
    assert.equal(
      entry.metrics.find((metric) => metric.check === "coverage").status,
      "not-run",
    );
  });
});
