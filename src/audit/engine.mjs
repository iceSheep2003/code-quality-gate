import { tool } from "../version.mjs";
import { historySpecification } from "./history-metrics.mjs";
import { runProcess } from "./process.mjs";
import { validateAudit } from "./config.mjs";
import { numeric, prepareReport, readReport } from "./reports.mjs";

function metricValue(metrics, path) {
  const normalized = path.replace(/\[(\d+)\]/g, ".$1");
  return numeric(metrics[normalized]);
}
function evaluateMetric(rule, metrics) {
  const value = metricValue(metrics, rule.path);
  if (value === undefined)
    return [
      {
        rule: "metric-missing",
        metric: rule.name,
        message: `Metric ${rule.path} was not found as a finite number in the report`,
      },
    ];
  const comparisons = [
    ["min", ">=", (actual, limit) => actual >= limit],
    ["max", "<=", (actual, limit) => actual <= limit],
    ["equals", "=", (actual, limit) => actual === limit],
  ];
  return comparisons
    .filter(
      ([key, , compare]) =>
        rule[key] !== undefined && !compare(value, rule[key]),
    )
    .map(([key, operator]) => ({
      rule: "metric-threshold",
      metric: rule.name,
      actual: value,
      limit: rule[key],
      operator,
      message: `${rule.name}: ${value}; required ${operator} ${rule[key]}`,
    }));
}
async function executeCheck(root, check, config) {
  const previous = await prepareReport(root, check);
  const processResult = await runProcess(check.command, {
    root,
    timeoutMs: check.timeoutMs ?? config.timeoutMs,
    maxOutputBytes: check.maxOutputBytes ?? config.maxOutputBytes,
  });
  const findings = [];
  if (processResult.code !== 0)
    findings.push({
      rule: "command-failed",
      message: `Command exited with code ${processResult.code}`,
      exitCode: processResult.code,
      output: processResult.stderr || processResult.stdout,
    });
  let report;
  try {
    report = await readReport(
      root,
      check,
      previous,
      check.maxReportBytes ?? config.maxReportBytes,
    );
  } catch (error) {
    return {
      status: "error",
      exitCode: processResult.code,
      metrics: {},
      violations: [
        ...findings,
        { rule: "report-error", message: error.message },
      ],
    };
  }
  findings.push(
    ...report.violations,
    ...(check.metrics || []).flatMap((rule) =>
      evaluateMetric(rule, report.metrics),
    ),
  );
  return {
    status: findings.length ? "failed" : "passed",
    exitCode: processResult.code,
    metrics: report.metrics,
    violations: findings,
  };
}
async function runCheck(root, check, config) {
  const started = Date.now();
  const identity = {
    id: check.id,
    title: check.title,
    required: check.required !== false,
    thresholds: check.metrics || [],
    reportFormat: check.format,
  };
  try {
    return {
      ...identity,
      ...(await executeCheck(root, check, config)),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ...identity,
      status: "error",
      durationMs: Date.now() - started,
      violations: [{ rule: "execution-error", message: error.message }],
    };
  }
}
function summarize(checks) {
  const blocking = checks.filter(
    (check) => check.required && check.status !== "passed",
  ).length;
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
    errors: checks.filter((check) => check.status === "error").length,
    blocking,
  };
}
export async function runAudit(root, input = {}) {
  const config = validateAudit(input);
  const checks = [];
  const startedAt = new Date().toISOString();
  for (const check of config.checks)
    checks.push(await runCheck(root, check, config));
  if (!checks.some((check) => check.required))
    checks.push({
      id: "audit-configuration",
      title: "Required quality checks",
      status: "error",
      required: true,
      violations: [
        {
          rule: "no-required-checks",
          message: "Configure at least one required audit check",
        },
      ],
    });
  const summary = summarize(checks);
  return {
    schemaVersion: 1,
    tool,
    startedAt,
    passed: summary.blocking === 0,
    checks,
    summary,
    history: historySpecification(config),
  };
}
