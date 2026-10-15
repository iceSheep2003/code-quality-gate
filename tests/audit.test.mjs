import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  runAudit,
  auditMarkdown,
  auditSarif,
  validateAudit,
} from "../src/index.mjs";
const cli = resolve("src/cli.mjs");
const check = (script = "process.exit(0)", extra = {}) => ({
  id: "acceptance",
  title: "Acceptance tests",
  command: ["node", "-e", script],
  ...extra,
});
const writer = (file, contents) =>
  `require('node:fs').writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(contents)})`;
async function project(fn) {
  const root = await mkdtemp(join(tmpdir(), "quality-audit-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function runCli(root, ...args) {
  return spawnSync(process.execPath, [cli, "audit", "--root", root, ...args], {
    encoding: "utf8",
  });
}
test("required command exit status gates the result and retains diagnostics", async () => {
  await project(async (root) => {
    const result = await runAudit(root, {
      checks: [
        check(),
        check("console.error('assertion failed');process.exit(3)", {
          id: "negative",
        }),
      ],
    });
    assert.equal(result.passed, false);
    assert.deepEqual(result.summary, {
      total: 2,
      passed: 1,
      failed: 1,
      errors: 0,
      blocking: 1,
    });
    assert.equal(result.checks[1].exitCode, 3);
    assert.match(auditMarkdown(result), /assertion failed/);
    assert.equal(auditSarif(result).runs[0].results.length, 1);
  });
});
test("JSON thresholds support nested fields, numeric strings, arrays and all operators", async () => {
  await project(async (root) => {
    const data = {
      metrics: { lines: "82", branches: 71 },
      totals: { duplication: 2 },
      files: [{ score: 60 }],
    };
    const result = await runAudit(root, {
      checks: [
        check(writer("coverage.json", JSON.stringify(data)), {
          report: "coverage.json",
          format: "json",
          metrics: [
            { name: "lines", path: "metrics.lines", min: 80 },
            { name: "branches", path: "branches", min: 80 },
            { name: "duplication", path: "totals.duplication", max: 3 },
            { name: "mutation", path: "files[0].score", equals: 60 },
          ],
        }),
      ],
    });
    assert.equal(result.passed, false);
    assert.equal(result.checks[0].violations.length, 1);
    assert.equal(result.checks[0].violations[0].metric, "branches");
    assert.match(auditMarkdown(result), /branches: 71 \(&gt;= 80\)/);
  });
});
test("missing, null, boolean, nonnumeric and inherited metrics cannot pass thresholds", async () => {
  await project(async (root) => {
    for (const data of [
      { x: null },
      { x: true },
      { x: "oops" },
      { x: "Infinity" },
      {},
    ]) {
      const result = await runAudit(root, {
        checks: [
          check(writer("metrics.json", JSON.stringify(data)), {
            report: "metrics.json",
            metrics: [{ name: "value", path: "x", min: 1 }],
          }),
        ],
      });
      assert.equal(result.checks[0].violations[0].rule, "metric-missing");
    }
  });
});
test("LCOV totals aggregate files and fail branch and function thresholds independently", async () => {
  await project(async (root) => {
    const lcov =
      "SF:a.c\nLF:10\nLH:9\nBRF:4\nBRH:2\nFNF:2\nFNH:1\nend_of_record\nSF:b.c\nLF:10\nLH:7\nBRF:4\nBRH:4\nFNF:2\nFNH:2\nend_of_record\n";
    const result = await runAudit(root, {
      checks: [
        check(writer("lcov.info", lcov), {
          report: "lcov.info",
          format: "lcov",
          metrics: [
            { name: "lines", path: "lines", min: 80 },
            { name: "branches", path: "branches", min: 80 },
            { name: "functions", path: "functions", min: 80 },
          ],
        }),
      ],
    });
    assert.equal(result.checks[0].metrics.lines, 80);
    assert.equal(result.checks[0].metrics.branches, 75);
    assert.equal(result.checks[0].violations.length, 2);
    for (const invalid of [
      "LF:10\nLH:11\nend_of_record",
      "LF:nope\nend_of_record",
      "LF:10",
      "LF:0\nend_of_record",
      "LF:1\nLF:1\nend_of_record",
    ]) {
      const bad = await runAudit(root, {
        checks: [
          check(writer("lcov.info", invalid), {
            report: "lcov.info",
            format: "lcov",
          }),
        ],
      });
      assert.equal(bad.checks[0].status, "error");
    }
  });
});
test("JUnit standard attributes, nested suites and cases are parsed without double counting", async () => {
  await project(async (root) => {
    const xml =
      '<testsuites tests="3"><testsuite tests="3"><testsuite tests="2"><testcase name="a"/><testcase name="b"/></testsuite><testcase name="c"><skipped/></testcase></testsuite></testsuites>';
    const result = await runAudit(root, {
      checks: [
        check(writer("junit.xml", xml), {
          report: "junit.xml",
          format: "junit",
          metrics: [
            { name: "tests", path: "tests", min: 3 },
            { name: "success", path: "successRate", min: 100 },
          ],
        }),
      ],
    });
    assert.equal(result.passed, false);
    assert.equal(result.checks[0].metrics.tests, 3);
    assert.equal(result.checks[0].metrics.skipped, 1);
    assert.equal(result.checks[0].metrics.passed, 2);
    const good = await runAudit(root, {
      checks: [
        check(
          writer(
            "junit.xml",
            '<testsuite tests="2" failures="0" errors="0" skipped="0"/>',
          ),
          { report: "junit.xml", format: "junit" },
        ),
      ],
    });
    assert.equal(good.passed, true);
  });
});
test("JUnit failures, no tests, invalid XML and inconsistent counts never pass on exit 0", async () => {
  await project(async (root) => {
    for (const xml of [
      '<testsuite tests="1" failures="1"/>',
      '<testsuite><testcase name="bad"><failure>wrong</failure></testcase></testsuite>',
      '<testsuites tests="0"/>',
      '<testsuite tests="1" skipped="1"/>',
      '<testsuite tests="1"><testcase name="bad"><error/></testcase></testsuite>',
      '<testsuite tests="2"><testcase name="one"/></testsuite>',
      '<testsuite tests="-1"/>',
      '<testsuite tests="one"/>',
      '<testsuite tests="1"><testcase></testsuite>',
      "<unrelated/>",
      '<!DOCTYPE testsuite [<!ENTITY a "hello">]><testsuite tests="1"/>',
    ]) {
      const result = await runAudit(root, {
        checks: [
          check(writer("junit.xml", xml), {
            report: "junit.xml",
            format: "junit",
          }),
        ],
      });
      assert.equal(result.passed, false, xml);
    }
  });
});
test("missing, stale, malformed and oversized reports fail closed and preserve exit-code failures", async () => {
  await project(async (root) => {
    const reporting = { report: "result.json", format: "json" };
    let result = await runAudit(root, {
      checks: [check("process.exit(4)", reporting)],
    });
    assert.equal(result.checks[0].status, "error");
    assert.equal(result.checks[0].violations[0].rule, "command-failed");
    await writeFile(join(root, "result.json"), '{"score":100}');
    result = await runAudit(root, { checks: [check(undefined, reporting)] });
    assert.match(result.checks[0].violations[0].message, /not regenerated/);
    result = await runAudit(root, {
      checks: [check(writer("result.json", "not json"), reporting)],
    });
    assert.equal(result.checks[0].status, "error");
    result = await runAudit(root, {
      maxReportBytes: 1024,
      checks: [check(writer("result.json", " ".repeat(2048)), reporting)],
    });
    assert.match(result.checks[0].violations[0].message, /size limit/);
  });
});
test("tool timeout, tool not found and output limits are explicit execution errors", async () => {
  await project(async (root) => {
    const result = await runAudit(root, {
      checks: [
        check("setInterval(()=>{},1000)", { id: "timeout", timeoutMs: 100 }),
        check("process.stdout.write('x'.repeat(5000))", {
          id: "output",
          maxOutputBytes: 1024,
        }),
        check(undefined, {
          id: "missing",
          command: ["portable-quality-no-such-tool-82736"],
        }),
      ],
    });
    assert.equal(result.summary.errors, 3);
    assert.match(result.checks[0].violations[0].message, /timed out/);
    assert.match(result.checks[1].violations[0].message, /output limit/);
    assert.match(result.checks[2].violations[0].message, /Unable to execute/);
  });
});
test("optional failures are visible without blocking required checks; empty or optional-only audits fail", async () => {
  await project(async (root) => {
    const optional = check("process.exit(1)", {
      id: "optional",
      required: false,
    });
    const result = await runAudit(root, { checks: [check(), optional] });
    assert.equal(result.passed, true);
    assert.equal(result.summary.failed, 1);
    assert.match(auditMarkdown(result), /FAILED \(optional\)/);
    assert.equal(auditSarif(result).runs[0].results[0].level, "warning");
    for (const config of [{}, { checks: [] }, { checks: [optional] }])
      assert.equal((await runAudit(root, config)).passed, false);
  });
});
test("commands receive literal argv without shell interpolation and run at project root", async () => {
  await project(async (root) => {
    const literal = '$(touch injected) ; echo `whoami` & | > < " unicode 中文';
    const result = await runAudit(root, {
      checks: [
        check(undefined, {
          command: [
            "node",
            "-e",
            writer("argv.txt", "") +
              ";require('node:fs').writeFileSync('argv.txt',process.argv[1])",
            literal,
          ],
        }),
      ],
    });
    assert.equal(result.passed, true);
    assert.equal(await readFile(join(root, "argv.txt"), "utf8"), literal);
  });
});
test("validation rejects invalid or ambiguous commands, thresholds, paths and unknown fields", () => {
  for (const bad of [
    { ...check(), command: "python -m pytest" },
    { ...check(), command: undefined },
    { ...check(), command: [] },
    { ...check(), command: ["node", "\0"] },
    { ...check(), command: [" "] },
    { ...check(), report: "../out.json" },
    { ...check(), report: "/out.json" },
    { ...check(), title: "" },
    { ...check(), id: "unsafe/id" },
    { ...check(), required: "true" },
    { ...check(), timeoutMs: -1 },
    { ...check(), maxOutputBytes: 0 },
    { ...check(), format: "junit" },
    { ...check(), metrics: [{ name: "x", path: "x", min: 1 }] },
    { ...check(), report: "r.json", metrics: [{ name: "x", path: "x" }] },
    {
      ...check(),
      report: "r.json",
      metrics: [{ name: "x", path: "x", min: NaN }],
    },
    {
      ...check(),
      report: "r.json",
      metrics: [{ name: "x", path: "x", min: 20, max: 10 }],
    },
  ])
    assert.throws(() => validateAudit({ checks: [bad] }));
  assert.throws(() => validateAudit({ checks: [check(), check()] }));
  assert.throws(() => validateAudit({ detectors: { pretend: true } }));
});
test(
  "report symlinks cannot escape the project",
  { skip: process.platform === "win32" },
  async () => {
    await project(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "quality-outside-"));
      try {
        await symlink(outside, join(root, "reports"));
        const result = await runAudit(root, {
          checks: [
            check(writer("reports/result.json", "{}"), {
              report: "reports/result.json",
            }),
          ],
        });
        assert.equal(result.checks[0].status, "error");
        await assert.rejects(readFile(join(outside, "result.json")));
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  },
);
test("Markdown escapes names and messages and includes thresholds, status and summary", () => {
  const markdown = auditMarkdown({
    passed: false,
    checks: [
      {
        id: "x",
        title: "X|Y\n<script>",
        status: "failed",
        metrics: {},
        violations: [{ message: "bad|value\n<img>" }],
      },
    ],
    summary: { failed: 1, blocking: 1 },
  });
  assert.match(markdown, /Status:\*\* FAIL/);
  assert.match(markdown, /X&#124;Y &lt;script&gt;/);
  assert.match(markdown, /bad&#124;value &lt;img&gt;/);
  assert.match(markdown, /1 blocking/);
});
test("CLI audits a non-JS project and emits Markdown by default, JSON and SARIF on demand", async () => {
  await project(async (root) => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/main.py"), "print('example')\n");
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ version: 1, audit: { checks: [check()] } }),
    );
    let result = runCli(root);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /# Code quality report/);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(runCli(root, "--json").stdout).passed, true);
    assert.equal(
      JSON.parse(runCli(root, "--format=sarif").stdout).version,
      "2.1.0",
    );
    await writeFile(
      join(root, "quality.config.json"),
      JSON.stringify({ audit: { checks: [check("process.exit(2)")] } }),
    );
    result = runCli(root);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL/);
    assert.equal(
      JSON.parse(runCli(root, "--format", "sarif").stdout).runs[0].results
        .length,
      1,
    );
    await writeFile(join(root, "quality.config.json"), "{}");
    assert.equal(runCli(root).status, 1);
    await writeFile(
      join(root, "quality.config.json"),
      '{"audit":{"checks":"invalid"}}',
    );
    result = runCli(root);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /Configuration/);
    assert.equal(JSON.parse(runCli(root, "--json").stdout).passed, false);
  });
});
