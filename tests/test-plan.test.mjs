import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateTask,
  runWorkflow,
  runGate,
  inspectTestPlan,
} from "../src/index.mjs";

const manifest = ".code-quality-gate/tasks/ADD.json";
const task = {
  version: 1,
  id: "ADD",
  title: "Add numbers",
  requirements: ["Add positive and negative numbers"],
  testFiles: ["unit.test.mjs", "regression.test.mjs"],
  codeFiles: ["business.mjs"],
  testChecks: ["acceptance"],
  protectedFiles: ["runner.mjs"],
  testPlan: {
    iterationChecks: ["static", "acceptance"],
    rationale:
      "Run task acceptance and static checks per edit; run the negative-number regression at the final gate.",
  },
};
async function project(fn, planned = true) {
  const root = await mkdtemp(join(tmpdir(), "cqg-test-plan-"));
  try {
    await mkdir(join(root, ".code-quality-gate/tasks"), { recursive: true });
    await mkdir(join(root, ".quality"));
    const input = { ...task };
    if (!planned) delete input.testPlan;
    await writeFile(join(root, manifest), JSON.stringify(input));
    await writeFile(join(root, "business.mjs"), "export const add=(a,b)=>0;");
    await writeFile(
      join(root, "unit.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './business.mjs';test('positive',()=>assert.equal(add(2,3),5));",
    );
    await writeFile(
      join(root, "regression.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './business.mjs';test('negative',()=>assert.equal(add(-2,3),1));",
    );
    await writeFile(
      join(root, "runner.mjs"),
      `import {appendFileSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const id=process.argv[2];appendFileSync('executed.log',id+'\\n');
if(id==='static'){assert.ok(!readFileSync('business.mjs','utf8').includes('eval('));}
else {const args=id==='acceptance'?['--test','--test-reporter=junit','--test-reporter-destination=.quality/unit.xml','unit.test.mjs']:['--test','--test-reporter=junit','--test-reporter-destination=.quality/regression.xml','regression.test.mjs'];const r=spawnSync(process.execPath,args,{stdio:'inherit'});process.exit(r.status??1);}
`,
    );
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({
        version: 1,
        audit: {
          checks: [
            {
              id: "acceptance",
              title: "Acceptance",
              command: [process.execPath, "runner.mjs", "acceptance"],
              format: "junit",
              report: ".quality/unit.xml",
              metrics: [{ name: "Success", path: "successRate", equals: 100 }],
            },
            {
              id: "static",
              title: "Static",
              command: [process.execPath, "runner.mjs", "static"],
            },
            {
              id: "regression",
              title: "Full regression",
              report: ".quality/regression.xml",
              format: "junit",
              command: [process.execPath, "runner.mjs", "regression"],
            },
          ],
          history: {
            metrics: [
              { check: "acceptance", path: "tests", label: "Tests" },
              { check: "regression", path: "tests", label: "Regression tests" },
            ],
          },
        },
      }),
    );
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const phase = (root, value) => runWorkflow({ root, manifest, phase: value });
const source = (root, value) => writeFile(join(root, "business.mjs"), value);
const executed = async (root) =>
  (await readFile(join(root, "executed.log"), "utf8")).trim().split("\n");

test("planned iterations run focused checks, but a fresh full gate catches untested regressions", async () => {
  await project(async (root) => {
    const red = await phase(root, "red");
    assert.equal(red.passed, true);
    assert.deepEqual(await executed(root), ["acceptance"]);
    await source(root, "export const add=(a,b)=>5;");
    const green = await phase(root, "green");
    assert.equal(green.passed, true);
    assert.equal(green.canMerge, false);
    assert.deepEqual(green.audit.execution.deferredChecks, ["regression"]);
    assert.deepEqual(await executed(root), [
      "acceptance",
      "acceptance",
      "static",
    ]);
    const gate = await runGate({ root });
    assert.equal(gate.passed, false);
    assert.equal(gate.canMerge, false);
    assert.deepEqual(gate.audit.execution.deferredChecks, []);
    assert.deepEqual((await executed(root)).slice(-3), [
      "acceptance",
      "static",
      "regression",
    ]);
    await source(root, "export const add=(a,b)=>a+b;");
    assert.equal((await phase(root, "green")).passed, true);
    assert.equal((await runGate({ root })).canMerge, true);
    const ledger = (
      await readFile(
        join(root, ".quality/code-quality-gate/history.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(ledger[1].audit.execution.selectedChecks, [
      "acceptance",
      "static",
    ]);
    assert.equal(
      ledger[1].metrics.find(
        (metric) => metric.check === "regression" && metric.path === "tests",
      ).status,
      "not-run",
    );
    assert.equal(
      ledger[1].metrics.find(
        (metric) => metric.check === "regression" && metric.path === "tests",
      ).actual,
      null,
    );
    const html = await readFile(join(root, green.html), "utf8");
    assert.ok(html.includes("测试方案"));
    assert.ok(html.includes("regression"));
    assert.match(
      await readFile(join(root, green.report), "utf8"),
      /Deferred to final gate:\*\* regression/,
    );
  });
});
test("without a plan green retains the full suite and catches the regression immediately", async () => {
  await project(async (root) => {
    assert.equal((await phase(root, "red")).passed, true);
    await source(root, "export const add=(a,b)=>5;");
    const result = await phase(root, "green");
    assert.equal(result.passed, false);
    assert.equal(result.audit.execution.mode, "full");
    assert.deepEqual((await executed(root)).slice(-3), [
      "acceptance",
      "static",
      "regression",
    ]);
  }, false);
});
test("plan previews are read only through API and CLI, including custom configuration and root", async () => {
  await project(async (root) => {
    const result = await inspectTestPlan({ root, manifest });
    assert.equal(result.canMerge, false);
    assert.deepEqual(result.phases[1].selectedChecks, ["acceptance", "static"]);
    assert.deepEqual(result.phases[2].selectedChecks, [
      "acceptance",
      "static",
      "regression",
    ]);
    await assert.rejects(access(join(root, "executed.log")));
    await writeFile(
      join(root, "custom.json"),
      await readFile(join(root, "quality.config.json")),
    );
    const output = spawnSync(
      process.execPath,
      [
        resolve("src/cli.mjs"),
        "plan",
        "ADD",
        "-C",
        root,
        "-c",
        "custom.json",
        "--json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(output.status, 0, output.stdout + output.stderr);
    assert.deepEqual(JSON.parse(output.stdout).phases, result.phases);
    await assert.rejects(access(join(root, "executed.log")));
  });
});
test("plans reject omitted acceptance, duplicates, unknown fields and unknown checks before execution", async () => {
  for (const plan of [
    { iterationChecks: ["static"], rationale: "Omit acceptance" },
    { iterationChecks: ["acceptance", "acceptance"], rationale: "Duplicate" },
    { iterationChecks: ["acceptance"], rationale: "" },
    {
      iterationChecks: ["acceptance"],
      rationale: "Explain",
      gateChecks: ["acceptance"],
    },
  ])
    assert.throws(() => validateTask({ ...task, testPlan: plan }));
  await project(async (root) => {
    await writeFile(
      join(root, manifest),
      JSON.stringify({
        ...task,
        testPlan: {
          iterationChecks: ["acceptance", "typo"],
          rationale: "Unknown check",
        },
      }),
    );
    await assert.rejects(phase(root, "red"), /Unknown test plan check/);
    await assert.rejects(access(join(root, "executed.log")));
  });
});
test("test plans freeze at red and cannot be narrowed after inspecting failures", async () => {
  await project(async (root) => {
    await phase(root, "red");
    await source(root, "export const add=(a,b)=>a+b;");
    const changed = {
      ...task,
      testPlan: { iterationChecks: ["acceptance"], rationale: "Remove static" },
    };
    await writeFile(join(root, manifest), JSON.stringify(changed));
    const result = await phase(root, "green");
    assert.equal(result.passed, false);
    assert.match(result.message, /changed after red/);
    assert.deepEqual(await executed(root), ["acceptance"]);
  });
});
