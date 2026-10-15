import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { within, discover, writeJson } from "../src/files.mjs";
test("source discovery and evidence writes reject escaping symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-safe-")),
    outside = await mkdtemp(join(tmpdir(), "quality-outside-"));
  try {
    await mkdir(join(root, "server"));
    await writeFile(join(outside, "external.mjs"), "export const x=1;");
    await symlink(
      join(outside, "external.mjs"),
      join(root, "server", "escape.mjs"),
    );
    await assert.rejects(within(root, "server/escape.mjs"));
    await assert.rejects(discover(root, ["server"]));
    await assert.rejects(within(root, "../external.mjs"));
    await symlink(outside, join(root, ".quality-tdd"));
    await assert.rejects(
      writeJson(root, ".quality-tdd/record.json", { passed: true }),
    );
    await assert.rejects(
      writeJson(root, ".quality-tdd/nested/record.json", { passed: true }),
    );
    await assert.rejects(access(join(outside, "nested")));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
test("safe evidence writes create local parent directories and reject symlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-write-"));
  try {
    await writeJson(root, "reports/check.json", { passed: true });
    await symlink(join(root, "reports/check.json"), join(root, "alias.json"));
    await assert.rejects(writeJson(root, "alias.json", { passed: false }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery prunes unrelated directories and handles source names beginning with dots", async () => {
  const root = await mkdtemp(join(tmpdir(), "quality-prune-"));
  const outside = await mkdtemp(join(tmpdir(), "quality-outside-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/..valid.mjs"), "export const x=1;");
    await symlink(outside, join(root, "unrelated"));
    assert.deepEqual(await discover(root, ["src/**/*.mjs"]), [
      "src/..valid.mjs",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
