import { hash } from "./ast.mjs";
export const defaults = Object.freeze({
  limits: Object.freeze({
    cyclomatic: 10,
    cognitive: 15,
    depth: 4,
    parameters: 4,
    statements: 40,
    lines: 80,
    fileLines: 500,
    fileFunctions: 40,
  }),
  coverage: Object.freeze({ lines: 90, functions: 90, branches: 80 }),
});
export function validateLimits(limits = {}) {
  for (const [name, value] of Object.entries(limits))
    if (
      !Object.hasOwn(defaults.limits, name) ||
      !Number.isInteger(value) ||
      value < 1
    )
      throw new Error("Unknown or invalid metric limit: " + name);
  return { ...defaults.limits, ...limits };
}
function metricViolations(record, limits, filename) {
  return Object.entries(record.metrics)
    .filter(
      ([metric, value]) =>
        Object.hasOwn(limits, metric) && value > limits[metric],
    )
    .map(([metric, actual]) => ({
      filename,
      function: record.name,
      line: record.line,
      column: record.column,
      fingerprint: record.fingerprint,
      metric,
      actual,
      limit: limits[metric],
    }));
}
function sourceViolations(report, limits) {
  const file = {
    name: "<module>",
    line: 1,
    column: 1,
    fingerprint: report.files.fingerprint,
    metrics: {
      fileLines: report.files.metrics.lines,
      fileFunctions: report.files.metrics.functions,
    },
  };
  return [
    ...report.functions.flatMap((f) =>
      metricViolations(f, limits, report.filename),
    ),
    ...metricViolations(file, limits, report.filename),
    ...report.findings.map((f) => ({ filename: report.filename, ...f })),
  ];
}
export const signature = (v) =>
  hash({
    filename: v.filename,
    fingerprint: v.fingerprint,
    metric: v.metric,
    actual: v.actual,
    limit: v.limit,
    rule: v.rule,
  });
function baselineCounts(baseline, limits) {
  if (!baseline) return new Map();
  if (
    baseline.version !== 1 ||
    baseline.policyHash !== hash(limits) ||
    !Array.isArray(baseline.entries)
  )
    throw new Error("Baseline version or policy does not match");
  const counts = new Map();
  for (const item of baseline.entries) {
    if (
      typeof item.signature !== "string" ||
      !Number.isInteger(item.count) ||
      item.count < 1
    )
      throw new Error("Invalid baseline entry");
    counts.set(item.signature, item.count);
  }
  return counts;
}
function splitLegacy(violations, counts) {
  const existing = [],
    introduced = [];
  for (const v of violations) {
    const key = signature(v),
      left = counts.get(key) || 0;
    if (left) {
      existing.push(v);
      counts.set(key, left - 1);
    } else introduced.push(v);
  }
  return { existing, introduced };
}
function coverageViolations(coverage) {
  if (coverage === undefined) return [];
  return Object.entries(defaults.coverage)
    .filter(
      ([metric, limit]) =>
        !Number.isFinite(coverage[metric]) ||
        coverage[metric] < limit ||
        coverage[metric] > 100,
    )
    .map(([metric, limit]) => ({
      metric: "coverage." + metric,
      actual: coverage[metric] ?? null,
      limit,
      message: "Coverage summary must meet the configured minimum",
    }));
}
export function evaluateReport(
  reports,
  { baseline, limits: requestedLimits, coverage } = {},
) {
  const limits = validateLimits(requestedLimits),
    syntax = reports.flatMap((r) =>
      r.parseErrors.map((e) => ({
        filename: r.filename,
        rule: "syntax",
        ...e,
      })),
    ),
    raw = reports.flatMap((r) => sourceViolations(r, limits));
  const { existing, introduced } = splitLegacy(
    raw,
    baselineCounts(baseline, limits),
  );
  const violations = [
    ...syntax,
    ...introduced,
    ...coverageViolations(coverage),
  ];
  if (!reports.length)
    violations.push({
      rule: "empty-scope",
      message: "No source files were analyzed",
    });
  return {
    passed: violations.length === 0,
    violations,
    legacy: existing,
    summary: {
      files: reports.length,
      functions: reports.reduce((n, r) => n + r.functions.length, 0),
      legacyViolations: existing.length,
    },
    limits,
    reports,
  };
}
export function createBaseline(reports, { limits: requestedLimits } = {}) {
  const limits = validateLimits(requestedLimits),
    counts = new Map();
  for (const v of reports.flatMap((r) => sourceViolations(r, limits))) {
    const key = signature(v);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    version: 1,
    policyHash: hash(limits),
    createdAt: new Date().toISOString(),
    entries: [...counts].map(([signature, count]) => ({ signature, count })),
  };
}
