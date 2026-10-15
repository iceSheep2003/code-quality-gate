import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateChange, recordPhase, verifyEvidence } from "../src/tdd.mjs";
const change = {
  id: "Q-001",
  title: "Only approved writes persist",
  requirements: [
    {
      id: "R-001",
      given: "User has a valid session",
      when: "A valid write completes",
      then: "The plan is saved once",
      tests: ["tests/business.test.mjs"],
    },
  ],
  codeFiles: ["server/business.mjs"],
};
test("business contracts require testable outcomes and reject traversal or arbitrary command fields", () => {
  assert.equal(validateChange(change).id, "Q-001");
  for (const bad of [
    { ...change, requirements: [] },
    { ...change, codeFiles: ["../secrets"] },
    { ...change, command: "rm -rf anything" },
    { ...change, requirements: [{ ...change.requirements[0], then: "" }] },
  ])
    assert.throws(() => validateChange(bad));
});
test("TDD evidence requires a real failing assertion followed by unchanged tests that pass", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-tdd-"));
  const manifest = "change.json";
  try {
    await mkdir(join(root, "server"));
    await mkdir(join(root, "tests"));
    await writeFile(join(root, manifest), JSON.stringify(change));
    await writeFile(
      join(root, "server/business.mjs"),
      "export const allowed=false;",
    );
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {allowed} from '../server/business.mjs';test('authorized write succeeds',()=>assert.equal(allowed,true));",
    );
    const red = await recordPhase({ root, manifest, phase: "red" });
    assert.equal(red.passed, true);
    assert.equal((await verifyEvidence({ root, manifest })).passed, false);
    await writeFile(
      join(root, "server/business.mjs"),
      "export const allowed=true;",
    );
    assert.equal(
      (await recordPhase({ root, manifest, phase: "green" })).passed,
      true,
    );
    assert.equal((await verifyEvidence({ root, manifest })).passed, true);
    await writeFile(
      join(root, "tests/business.test.mjs"),
      (await readFile(join(root, "tests/business.test.mjs"), "utf8")) +
        "\n// modified after verification",
    );
    assert.equal((await verifyEvidence({ root, manifest })).passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("module-loading failures and initially green tests cannot masquerade as red", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-tdd-"));
  try {
    await mkdir(join(root, "server"));
    await mkdir(join(root, "tests"));
    await writeFile(join(root, "change.json"), JSON.stringify(change));
    await writeFile(
      join(root, "server/business.mjs"),
      "export const allowed=true;",
    );
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import './missing-file.mjs';",
    );
    assert.equal(
      (await recordPhase({ root, manifest: "change.json", phase: "red" }))
        .passed,
      false,
    );
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import test from 'node:test';test('already works',()=>{});",
    );
    assert.equal(
      (await recordPhase({ root, manifest: "change.json", phase: "red" }))
        .passed,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reviewed refactors require passing unchanged tests before and after, without inventing red", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-refactor-"));
  const contract = {
    ...change,
    kind: "refactor",
    review: "Maintainer requested behavior-preserving extraction",
    codeFiles: [...change.codeFiles, "server/extracted.mjs"],
  };
  const opts = { root, manifest: "change.json" };
  try {
    assert.doesNotThrow(() => validateChange(contract));
    await mkdir(join(root, "server"));
    await mkdir(join(root, "tests"));
    await writeFile(join(root, opts.manifest), JSON.stringify(contract));
    await writeFile(
      join(root, "server/business.mjs"),
      "export const allowed=true;",
    );
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {allowed} from '../server/business.mjs';test('authorized write succeeds',()=>assert.equal(allowed,true));",
    );
    assert.equal(
      (await recordPhase({ ...opts, phase: "green" })).passed,
      false,
    );
    assert.equal((await recordPhase({ ...opts, phase: "red" })).passed, false);
    assert.equal(
      (await recordPhase({ ...opts, phase: "baseline" })).passed,
      true,
    );
    assert.equal((await verifyEvidence(opts)).passed, false);
    await writeFile(
      join(root, "server/extracted.mjs"),
      "export const allowed=true;",
    );
    await writeFile(
      join(root, "server/business.mjs"),
      "export {allowed} from './extracted.mjs';",
    );
    assert.equal((await recordPhase({ ...opts, phase: "green" })).passed, true);
    assert.equal((await verifyEvidence(opts)).passed, true);
    const record = JSON.parse(
      await readFile(join(root, ".quality-tdd/Q-001.json"), "utf8"),
    );
    assert.equal(record.red, undefined);
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import test from 'node:test';test('weakened test',()=>{});",
    );
    assert.equal(
      (await recordPhase({ ...opts, phase: "green" })).passed,
      false,
    );
    assert.equal((await verifyEvidence(opts)).passed, false);
    assert.throws(() => validateChange({ ...contract, review: "" }));
    assert.throws(() => validateChange({ ...contract, kind: "skip" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refactor baseline rejects failing tests and behavior changes cannot use baseline phase", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-refactor-"));
  const opts = { root, manifest: "change.json", phase: "baseline" };
  try {
    await mkdir(join(root, "server"));
    await mkdir(join(root, "tests"));
    await writeFile(
      join(root, "server/business.mjs"),
      "export const allowed=false;",
    );
    await writeFile(
      join(root, "tests/business.test.mjs"),
      "import test from 'node:test';import assert from 'node:assert/strict';import {allowed} from '../server/business.mjs';test('authorized write',()=>assert.equal(allowed,true));",
    );
    await writeFile(join(root, opts.manifest), JSON.stringify(change));
    assert.equal((await recordPhase(opts)).passed, false);
    await writeFile(
      join(root, opts.manifest),
      JSON.stringify({
        ...change,
        kind: "refactor",
        review: "Approved extraction",
      }),
    );
    assert.equal((await recordPhase(opts)).passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
