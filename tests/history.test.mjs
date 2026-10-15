import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordHistory } from "../src/audit/history.mjs";
const task = {
  id: "HISTORY",
  title: "Track quality",
  codeFiles: ["src/business.py"],
};
const audit = (value = 65, passed = false) => ({
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  passed,
  checks: [
    {
      id: "coverage",
      title: "Coverage",
      required: true,
      status: passed ? "passed" : "failed",
      exitCode: 0,
      durationMs: 10,
      metrics: { lines: value, branches: value - 10 },
      thresholds: [
        { name: "Line coverage", path: "lines", min: 80 },
        { name: "Branch coverage", path: "branches", min: 70 },
      ],
    },
  ],
  summary: {
    total: 1,
    passed: passed ? 1 : 0,
    failed: passed ? 0 : 1,
    errors: 0,
    blocking: passed ? 0 : 1,
  },
});
async function project(fn) {
  const root = await mkdtemp(join(tmpdir(), "quality-history-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/business.py"), "result = 0\n");
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const record = (root, result, extra = {}) =>
  recordHistory(root, {
    task,
    phase: "green",
    accepted: result.passed,
    audit: result,
    message: "Quality iteration",
    ...extra,
  });
test("history appends real metrics and code revisions; Markdown compares iterations without overwriting earlier facts", async () => {
  await project(async (root) => {
    const first = await record(root, audit());
    assert.ok(first);
    const original = await readFile(join(root, first.jsonl), "utf8");
    await writeFile(join(root, "src/business.py"), "result = 5\n");
    const second = await record(root, audit(90, true), {
      note: "Cover the boundary branch",
    });
    assert.ok(second);
    const lines = (await readFile(join(root, second.jsonl), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.ok(
      (await readFile(join(root, second.jsonl), "utf8")).startsWith(original),
    );
    assert.equal(
      lines[0].metrics.find((metric) => metric.path === "lines").actual,
      65,
    );
    assert.equal(
      lines[1].metrics.find((metric) => metric.path === "lines").actual,
      90,
    );
    assert.equal(lines[0].metrics[0].min, 80);
    assert.notEqual(lines[0].source.fingerprint, lines[1].source.fingerprint);
    assert.deepEqual(lines[1].source.changedFiles, ["src/business.py"]);
    assert.equal(lines[1].note, "Cover the boundary branch");
    assert.equal(lines[1].checks[0].durationMs, 10);
    const markdown = await readFile(join(root, second.markdown), "utf8");
    assert.match(markdown, /65/);
    assert.match(markdown, /90/);
    assert.match(markdown, /Line coverage/);
    assert.match(markdown, /Cover the boundary branch/);
    assert.match(markdown, /src\/business.py/);
  });
});
test("unmeasured metrics stay missing, configured checks absent from a red run stay not-run, and a legitimate zero is preserved", async () => {
  await project(async (root) => {
    const input = audit(0);
    input.history = {
      definitions: [
        { check: "coverage", path: "lines", label: "Line coverage", min: 80 },
        { check: "coverage", path: "unknown", label: "Unknown", min: 1 },
        { check: "mutation", path: "score", label: "Mutation score", min: 60 },
      ],
    };
    const result = await record(root, input, { phase: "red", accepted: true });
    assert.ok(result);
    const entry = JSON.parse(
      (await readFile(join(root, result.jsonl), "utf8")).trim(),
    );
    assert.equal(entry.metrics.find((m) => m.path === "lines").actual, 0);
    assert.equal(
      entry.metrics.find((m) => m.path === "unknown").status,
      "missing",
    );
    assert.equal(
      entry.metrics.find((m) => m.check === "mutation").status,
      "not-run",
    );
    assert.equal(
      entry.metrics.find((m) => m.check === "mutation").actual,
      null,
    );
    assert.equal(entry.accepted, true);
    assert.equal(entry.auditPassed, false);
    assert.match(
      await readFile(join(root, result.markdown), "utf8"),
      /not-run/,
    );
  });
});
test("history keeps policy changes, missing/deleted files and unchanged iterations explicit", async () => {
  await project(async (root) => {
    const first = await record(root, audit(80, true));
    assert.ok(first);
    const second = await record(root, audit(80, true));
    assert.ok(second);
    await rm(join(root, "src/business.py"));
    const changed = audit(80);
    changed.checks[0].thresholds[0].min = 90;
    const third = await record(root, changed);
    assert.ok(third);
    const entries = (await readFile(join(root, third.jsonl), "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.deepEqual(entries[1].source.changedFiles, []);
    assert.deepEqual(entries[2].source.changedFiles, ["src/business.py"]);
    assert.equal(entries[2].source.files["src/business.py"], null);
    assert.equal(entries[0].metrics[0].min, 80);
    assert.equal(entries[2].metrics[0].min, 90);
    assert.equal(entries[2].metrics[0].status, "failed");
  });
});
test("history does not overwrite a corrupt ledger or pretend it started a new history", async () => {
  await project(async (root) => {
    const first = await record(root, audit());
    assert.ok(first);
    await writeFile(join(root, first.jsonl), '{"partial":');
    await assert.rejects(record(root, audit()), /history|ledger/i);
    assert.equal(
      await readFile(join(root, first.jsonl), "utf8"),
      '{"partial":',
    );
  });
});
test("history escapes agent notes and table labels without changing raw metric values", async () => {
  await project(async (root) => {
    const input = audit();
    input.checks[0].thresholds[0].name = "coverage|<script>";
    const result = await record(root, input, {
      note: "fixed|branch\n<script>bad</script>",
    });
    assert.ok(result);
    const markdown = await readFile(join(root, result.markdown), "utf8");
    assert.ok(!markdown.includes("<script>"));
    assert.match(markdown, /&#124;/);
    assert.match(markdown, /&lt;script&gt;/);
  });
});

test("changing an old numeric observation breaks history consistency and cannot be silently accepted", async () => {
  await project(async (root) => {
    const result = await record(root, audit());
    assert.ok(result);
    const path = join(root, result.jsonl);
    const entry = JSON.parse((await readFile(path, "utf8")).trim());
    entry.metrics[0].actual = 100;
    await writeFile(path, JSON.stringify(entry) + "\n");
    await assert.rejects(record(root, audit(90, true)), /history|ledger/i);
  });
});

test("history column configuration validates check references and duplicate columns", async () => {
  const { validateAudit } = await import("../src/index.mjs");
  const checks = [
    { id: "tests", title: "Tests", command: ["node", "-e", "process.exit(0)"] },
  ];
  assert.doesNotThrow(() =>
    validateAudit({
      checks,
      history: { metrics: [{ check: "tests", path: "tests", label: "Tests" }] },
    }),
  );
  for (const history of [
    { metrics: [{ check: "missing", path: "score", label: "Score" }] },
    { metrics: [{ check: "tests", path: "tests" }] },
    {
      metrics: [
        { check: "tests", path: "tests", label: "A" },
        { check: "tests", path: "tests", label: "B" },
      ],
    },
    { unknown: true },
  ])
    assert.throws(() => validateAudit({ checks, history }));
});
