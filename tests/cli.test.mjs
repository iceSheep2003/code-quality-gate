import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const cli = resolve("src/cli.mjs");
test("help and version have short discoverable command forms", () => {
  const help = spawnSync(process.execPath, [cli, "help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /cqg mcp/);
  assert.match(help.stdout, /cqg red/);
  const version = spawnSync(process.execPath, [cli, "version"], {
    encoding: "utf8",
  });
  const legacy = spawnSync(process.execPath, [cli, "--version"], {
    encoding: "utf8",
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, legacy.stdout);
});
test("short root and format flags work from another working directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quality-short-cli-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/good.mjs"), "export const good=1;");
    const result = spawnSync(
      process.execPath,
      [cli, "check", "-C", dir, "-f=json"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(JSON.parse(result.stdout).summary.files, 1);
    for (const flag of [["-f=json"], ["-f", "json"]]) {
      const invalid = spawnSync(
        process.execPath,
        [cli, "check", ...flag, "--unknown"],
        { encoding: "utf8" },
      );
      assert.equal(invalid.status, 2);
      assert.equal(
        JSON.parse(invalid.stdout).violations[0].rule,
        "configuration",
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI fails closed for empty scope, syntax errors and unknown config fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quality-cli-"));
  try {
    await writeFile(
      join(dir, "quality.config.json"),
      JSON.stringify({ include: ["server"], baseline: "baseline.json" }),
    );
    let r = spawnSync(process.execPath, [cli, "check", "--root", dir], {
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    await mkdir(join(dir, "server"));
    await writeFile(join(dir, "server", "bad.mjs"), "function bad( {");
    r = spawnSync(process.execPath, [cli, "check", "--root", dir], {
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    await writeFile(
      join(dir, "quality.config.json"),
      JSON.stringify({ include: ["server"], skipEverything: true }),
    );
    r = spawnSync(process.execPath, [cli, "check", "--root", dir], {
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("project gate requires red/green evidence when tracked business code changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quality-cli-tdd-"));
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args, "--root", dir, "--json"], {
      encoding: "utf8",
    });
  try {
    await mkdir(join(dir, "server"));
    await mkdir(join(dir, "tests"));
    await mkdir(join(dir, "quality", "changes"), { recursive: true });
    await writeFile(
      join(dir, "quality.config.json"),
      JSON.stringify({
        include: ["server"],
        baseline: "baseline.json",
        requireTdd: true,
      }),
    );
    await writeFile(
      join(dir, "server", "business.mjs"),
      "export const allowed=false;",
    );
    assert.equal(run("baseline", "--accept-existing").status, 0);
    const contract = {
      id: "Q-CLI",
      title: "Authorized writes work",
      requirements: [
        {
          id: "R-1",
          given: "Valid user",
          when: "Saving a plan",
          then: "The write is allowed",
          tests: ["tests/business.test.mjs"],
        },
      ],
      codeFiles: ["server/business.mjs"],
    };
    await writeFile(
      join(dir, "quality/changes/Q-CLI.json"),
      JSON.stringify(contract),
    );
    await writeFile(
      join(dir, "tests/business.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {allowed} from '../server/business.mjs';test('valid write',()=>assert.equal(allowed,true));",
    );
    assert.equal(
      run("tdd", "--change", "quality/changes/Q-CLI.json", "--phase", "red")
        .status,
      0,
    );
    await writeFile(
      join(dir, "server", "business.mjs"),
      "export const allowed=true;",
    );
    assert.equal(run("check").status, 1);
    assert.equal(
      run("tdd", "--change", "quality/changes/Q-CLI.json", "--phase", "green")
        .status,
      0,
    );
    assert.equal(run("check").status, 0);
    await writeFile(
      join(dir, "server", "business.mjs"),
      "export const allowed=true; export const extra=1;",
    );
    assert.equal(run("check").status, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("CLI reports structured violations and passes simple business code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quality-cli-"));
  try {
    await mkdir(join(dir, "server"));
    await writeFile(
      join(dir, "quality.config.json"),
      JSON.stringify({ include: ["server"], baseline: "baseline.json" }),
    );
    await writeFile(
      join(dir, "server", "good.mjs"),
      "export function add(a,b){return a+b;}",
    );
    let r = spawnSync(
      process.execPath,
      [cli, "check", "--root", dir, "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).passed, true);
    await writeFile(
      join(dir, "server", "good.mjs"),
      "export function add(a,b,c,d,e){return a+b;}",
    );
    r = spawnSync(process.execPath, [cli, "check", "--root", dir, "--json"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.ok(
      JSON.parse(r.stdout).violations.some((v) => v.metric === "parameters"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
