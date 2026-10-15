import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { reportHtml } from "../src/html/report.mjs";
import { recordHistory } from "../src/audit/history.mjs";

const metric = (actual, status = "passed") => ({
  check: "coverage",
  path: "branches",
  label: "Branch coverage (%)",
  actual,
  status,
  min: 80,
});
const entry = (sequence, value, extra = {}) => ({
  sequence,
  iteration: sequence,
  timestamp: "2026-10-16T01:00:00Z",
  task: { id: "TASK", title: "Boundary behavior" },
  phase: "green",
  accepted: false,
  auditPassed: false,
  canMerge: false,
  note: "Fix the boundary",
  message: "Required checks failed",
  source: {
    fingerprint: "abc123",
    changedFiles: ["src/main.py"],
    baseline: false,
  },
  displayMetrics: [],
  metrics: [value],
  checks: [],
  ...extra,
});
test("HTML keeps real values, per-iteration thresholds and separate workflow decisions", () => {
  const entries = [
    entry(1, metric(null, "not-run"), { phase: "red", accepted: true }),
    entry(2, metric(0, "failed")),
    entry(3, { ...metric(70, "failed"), min: 90 }),
    entry(4, metric(null, "error")),
    entry(5, metric(85), { accepted: true, auditPassed: true }),
  ];
  const html = reportHtml({ entries });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /RED accepted/);
  assert.match(html, /NOT READY/);
  assert.match(html, /not-run/);
  assert.match(html, />0<\/strong>/);
  assert.match(html, /≥ 90/);
  assert.match(html, /data-sequence="5"/);
  assert.match(html, /<svg[^>]+role="img"/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  assert.match(html, /Content-Security-Policy/);
});
test("HTML escapes tool output, filenames and agent notes without executable markup", () => {
  const attack =
    '</script><img src=x onerror="alert(1)"><svg onload="alert(2)">';
  const html = reportHtml({
    entries: [
      entry(
        1,
        { ...metric(0), label: attack },
        {
          note: attack,
          task: { id: "TASK", title: attack },
          source: { changedFiles: [attack], fingerprint: attack },
          checks: [
            {
              id: attack,
              title: attack,
              status: "error",
              required: true,
              details: attack,
            },
          ],
        },
      ),
    ],
  });
  assert.doesNotMatch(html, /<img|<svg onload|<\/script><img/);
  assert.match(html, /&lt;\/script&gt;/);
  assert.match(html, /&quot;alert\(1\)&quot;/);
});

test("diagnostic values without bounds are measured, not a claimed threshold pass", () => {
  const observation = entry(1, { ...metric(2), min: undefined });
  assert.match(reportHtml({ entries: [observation] }), />measured<\/span>/);
});

test("static HTML includes measured per-function data and does not grant merge readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "cqg-static-html-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/add.mjs"),
      "export function add(a,b){return a+b;}",
    );
    const output = spawnSync(
      process.execPath,
      [resolve("src/cli.mjs"), "check", "-f", "html"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(output.status, 0, output.stderr);
    assert.match(output.stdout, /JS\/TS static analysis/);
    assert.match(output.stdout, /src\/add.mjs/);
    assert.match(output.stdout, /Cyclomatic/);
    assert.match(output.stdout, /NOT READY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("history charts break at unmeasured points and do not connect different tasks", () => {
  const html = reportHtml({
    entries: [
      entry(1, metric(10)),
      entry(2, metric(null, "missing")),
      entry(3, metric(30)),
      entry(4, metric(40), { task: { id: "OTHER", title: "Other task" } }),
    ],
  });
  const paths = [...html.matchAll(/class="trend-line" d="([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(paths.length, 2);
  assert.equal((paths[0].match(/M/g) || []).length, 2);
  assert.doesNotMatch(paths[0], /L/);
});
test("HTML history is generated from the validated ledger without editing previous records", async () => {
  const root = await mkdtemp(join(tmpdir(), "cqg-html-history-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/main.py"), "value = 0\n");
    const input = {
      task: { id: "TASK", title: "Track HTML", codeFiles: ["src/main.py"] },
      phase: "green",
      accepted: false,
      audit: {
        passed: false,
        checks: [],
        summary: {},
        history: { definitions: [], display: [] },
      },
    };
    const first = await recordHistory(root, input);
    const before = await readFile(join(root, first.jsonl), "utf8");
    const second = await recordHistory(root, input);
    assert.ok(
      (await readFile(join(root, second.jsonl), "utf8")).startsWith(before),
    );
    for (const path of [second.html]) {
      const html = await readFile(join(root, path), "utf8");
      assert.match(html, /data-sequence="1"/);
      assert.match(html, /data-sequence="2"/);
      assert.match(html, /No numeric metrics/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("CLI saves self-contained HTML by default and supports HTML output and configuration errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "cqg-html-cli-"));
  const cli = resolve("src/cli.mjs");
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({
        audit: {
          checks: [
            {
              id: "tests",
              title: "Command check",
              command: [process.execPath, "-e", "process.exit(1)"],
            },
          ],
        },
      }),
    );
    const result = run("audit", "--json");
    assert.equal(result.status, 1, result.stderr + result.stdout);
    const data = JSON.parse(result.stdout);
    assert.ok(data.html.endsWith(".html"));
    assert.equal(data.html, ".quality/code-quality-gate/report.html");
    assert.equal(data.html, data.history.html);
    for (const path of [data.html]) {
      assert.match(
        await readFile(join(root, path), "utf8"),
        /<!doctype html>/i,
      );
    }
    const output = run("audit", "-f", "html");
    assert.equal(output.status, 1);
    assert.match(output.stdout, /^<!doctype html>/i);
    await writeFile(
      join(root, "quality.config.json"),
      '{"audit":{"checks":"bad"}}',
    );
    const invalid = run("audit", "-f=html");
    assert.equal(invalid.status, 2);
    assert.match(invalid.stdout, /^<!doctype html>/i);
    assert.match(invalid.stdout, /Configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("one HTML file retains all tasks, every recorded metric, diagnostics and original observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "cqg-single-html-"));
  try {
    const metrics = Object.fromEntries(
      Array.from({ length: 35 }, (_, index) => [`score${index}`, index]),
    );
    const input = {
      task: { id: "ONE" },
      phase: "audit",
      accepted: false,
      audit: {
        passed: false,
        summary: { failed: 1 },
        checks: [
          {
            id: "detector",
            title: "Detector",
            status: "failed",
            required: true,
            metrics,
            thresholds: [],
            violations: [
              {
                message: "Failed assertion",
                output: "<script>unsafe</script>\nfull diagnostic",
              },
            ],
          },
        ],
        history: {
          definitions: Object.keys(metrics).map((path) => ({
            check: "detector",
            path,
            label: path,
          })),
          display: [
            { check: "detector", path: "score0", label: "Selected column" },
          ],
        },
      },
    };
    const first = await recordHistory(root, input);
    const before = await readFile(join(root, first.jsonl), "utf8");
    const second = await recordHistory(root, { ...input, task: { id: "TWO" } });
    assert.equal(first.html, second.html);
    const paths = await readdir(join(root, ".quality"), { recursive: true });
    assert.deepEqual(
      paths.filter((path) => path.endsWith(".html")),
      [join("code-quality-gate", "report.html")],
    );
    assert.ok(
      (await readFile(join(root, first.jsonl), "utf8")).startsWith(before),
    );
    const html = await readFile(join(root, second.html), "utf8");
    for (const content of [
      "ONE",
      "TWO",
      "score34",
      "Selected column",
      "full diagnostic",
      "All recorded data",
      "&lt;script&gt;unsafe&lt;/script&gt;",
    ])
      assert.ok(html.includes(content), content);
    assert.doesNotMatch(html, /<script>unsafe/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
