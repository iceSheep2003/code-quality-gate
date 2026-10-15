import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { analyzeSource, evaluateReport } from "../src/index.mjs";
import { tool } from "../src/version.mjs";
const cli = resolve("src/cli.mjs");
const run = (root, ...args) =>
  spawnSync(process.execPath, [cli, ...args, "--root", root], {
    encoding: "utf8",
  });
async function project(fn) {
  const root = await mkdtemp(join(tmpdir(), "portable-quality-"));
  try {
    await mkdir(join(root, "src"));
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("TypeScript and JSX are parsed and checked rather than silently ignored", () => {
  for (const [filename, code] of [
    [
      "src/example.ts",
      "export function value(x: number): number {if(x>0)return x;return 0;}",
    ],
    [
      "src/example.tsx",
      "export function View({title}: {title: string}) {return <h1>{title}</h1>;}",
    ],
    ["src/example.jsx", "export const View=()=> <p>Hello</p>;"],
  ]) {
    const report = analyzeSource(code, { filename });
    assert.equal(report.parseErrors.length, 0);
    assert.equal(report.functions.length, 1);
    assert.equal(evaluateReport([report]).passed, true);
  }
  const unsafe = analyzeSource(
    'export function x():unknown{return eval("1");}',
    { filename: "src/unsafe.ts" },
  );
  assert.ok(
    evaluateReport([unsafe]).violations.some((v) => v.rule === "no-eval"),
  );
});
test("zero config excludes dependencies, scans TS, and returns versioned JSON", async () => {
  await project(async (root) => {
    await writeFile(join(root, "src/good.ts"), "export const n: number = 1;");
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules/ignored.js"), "bad syntax {{{");
    const result = run(root, "check", "--json");
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.files, 1);
  });
});
test("explicit config supports files, glob include, exclude, and scopes outside server/shared", async () => {
  await project(async (root) => {
    await writeFile(join(root, "src/good.mjs"), "export const good=1;");
    await writeFile(join(root, "src/ignored.mjs"), "bad syntax {{{");
    await writeFile(
      join(root, "custom.json"),
      JSON.stringify({
        include: ["src/**/*.mjs"],
        exclude: ["src/ignored.mjs"],
      }),
    );
    const r = run(root, "check", "--config", "custom.json", "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).summary.files, 1);
    await writeFile(
      join(root, "custom.json"),
      JSON.stringify({ include: ["src/good.mjs"] }),
    );
    assert.equal(run(root, "check", "--config", "custom.json").status, 0);
  });
});
test("baselines apply to arbitrary projects but cannot mask modified functions", async () => {
  await project(async (root) => {
    const file = join(root, "src/wide.js");
    await writeFile(file, "export function wide(a,b,c,d,e){return a;}");
    assert.equal(run(root, "check", "--json").status, 1);
    assert.equal(run(root, "baseline", "--accept-existing").status, 0);
    assert.equal(run(root, "check", "--json").status, 0);
    await writeFile(file, "export function wide(a,b,c,d,e){return b;}");
    assert.equal(run(root, "check", "--json").status, 1);
  });
});
test("dependency cycles include imports and re-exports; dynamic paths are outside resolution", async () => {
  await project(async (root) => {
    await writeFile(
      join(root, "src/a.ts"),
      'export {b} from "./b.js"; export const a=1;',
    );
    await writeFile(
      join(root, "src/b.ts"),
      'import {a} from "./a.js"; export const b=a;',
    );
    let result = run(root, "check", "--json");
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(
      JSON.parse(result.stdout).violations.some(
        (v) => v.rule === "dependency-cycle",
      ),
    );
    await writeFile(join(root, "src/b.ts"), "export const b=1;");
    result = run(root, "check", "--format", "sarif");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const sarif = JSON.parse(result.stdout);
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].results.length, 0);
  });
});
test("SARIF reports source locations and help/version/init work independently", async () => {
  await project(async (root) => {
    assert.equal(run(root, "--help").status, 0);
    assert.equal(run(root, "--version").stdout.trim(), tool.version);
    assert.equal(run(root, "init").status, 0);
    assert.equal(run(root, "init").status, 2);
    await writeFile(
      join(root, "src/bad.js"),
      'export function x(){return eval("1");}',
    );
    const r = run(root, "check", "--format", "sarif");
    assert.equal(r.status, 1);
    const sarif = JSON.parse(r.stdout);
    const finding = sarif.runs[0].results.find((v) => v.ruleId === "no-eval");
    assert.equal(
      finding.locations[0].physicalLocation.artifactLocation.uri,
      "src/bad.js",
    );
    assert.equal(finding.locations[0].physicalLocation.region.startLine, 1);
  });
});
test("optional TDD tracks src code, and empty scope or unsafe paths fail closed", async () => {
  await project(async (root) => {
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ include: ["src"], requireTdd: true }),
    );
    await writeFile(join(root, "src/app.js"), "export const app=1;");
    const r = run(root, "check", "--json");
    assert.equal(r.status, 1);
    assert.ok(
      JSON.parse(r.stdout).violations.some((v) => v.rule === "tdd-evidence"),
    );
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ include: ["../outside"] }),
    );
    assert.equal(run(root, "check", "--json").status, 2);
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ include: ["src/missing*"] }),
    );
    assert.equal(run(root, "check", "--json").status, 1);
  });
});

test("type-only imports are excluded from runtime cycles and relative require is supported", () => {
  const a = analyzeSource('import {type T} from "./b.ts"; export const a=1;', {
    filename: "src/a.ts",
  });
  assert.deepEqual(a.dependencies, []);
  const b = analyzeSource('export type {T} from "./a.ts";', {
    filename: "src/b.ts",
  });
  assert.deepEqual(b.dependencies, []);
  const c = analyzeSource('const a=require("./a.cjs"); import("./b.cjs");', {
    filename: "src/c.cjs",
  });
  assert.deepEqual(
    c.dependencies.map((d) => d.specifier),
    ["./a.cjs", "./b.cjs"],
  );
});

test("TDD can track a real red/green change in an arbitrary src project", async () => {
  await project(async (root) => {
    await mkdir(join(root, "test"));
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ include: ["src"], requireTdd: true }),
    );
    await writeFile(
      join(root, "src/feature.mjs"),
      "export const allowed=false;",
    );
    assert.equal(run(root, "baseline", "--accept-existing").status, 0);
    const change = {
      id: "FEATURE",
      title: "Allow valid requests",
      requirements: [
        {
          id: "R1",
          given: "Valid input",
          when: "Requested",
          then: "Allowed",
          tests: ["test/feature.test.mjs"],
        },
      ],
      codeFiles: ["src/feature.mjs"],
    };
    await mkdir(join(root, "quality/changes"), { recursive: true });
    await writeFile(
      join(root, "quality/changes/FEATURE.json"),
      JSON.stringify(change),
    );
    await writeFile(
      join(root, "test/feature.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {allowed} from '../src/feature.mjs';test('allowed',()=>assert.equal(allowed,true));",
    );
    assert.equal(
      run(
        root,
        "tdd",
        "--change",
        "quality/changes/FEATURE.json",
        "--phase",
        "red",
        "--json",
      ).status,
      0,
    );
    await writeFile(
      join(root, "src/feature.mjs"),
      "export const allowed=true;",
    );
    assert.equal(run(root, "check").status, 1);
    assert.equal(
      run(
        root,
        "tdd",
        "--change",
        "quality/changes/FEATURE.json",
        "--phase",
        "green",
        "--json",
      ).status,
      0,
    );
    assert.equal(run(root, "check").status, 0);
    assert.equal(
      run(root, "verify", "--change", "quality/changes/FEATURE.json").status,
      0,
    );
  });
});
