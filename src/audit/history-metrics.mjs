import { numeric } from "./reports.mjs";
const standard = {
  junit: ["tests", "passed", "failures", "errors", "skipped", "successRate"],
  lcov: ["lines", "branches", "functions"],
};
export function historySpecification(config = {}) {
  const definitions = (config.checks || []).flatMap(checkDefinitions);
  const display = config.history?.metrics || [];
  for (const item of display)
    if (!definitions.some((rule) => metricKey(rule) === metricKey(item)))
      definitions.push(item);
  return { definitions, display };
}
function checkDefinitions(check) {
  const definitions = (check.metrics || []).map((rule) => ({
    check: check.id,
    path: rule.path,
    label: `${check.title}: ${rule.name}`,
    ...bounds(rule),
  }));
  for (const path of standard[check.format] || [])
    if (!definitions.some((item) => item.path === path))
      definitions.push({
        check: check.id,
        path,
        label: `${check.title}: ${path}`,
      });
  return definitions;
}
function bounds(rule) {
  return Object.fromEntries(
    ["min", "max", "equals"]
      .filter((key) => rule[key] !== undefined)
      .map((key) => [key, rule[key]]),
  );
}
export function metricKey(metric) {
  return `${metric.check}:${metric.path}`;
}
function metricStatus(check, actual, rule) {
  if (!check) return "not-run";
  if (check.status === "error") return "error";
  if (actual === undefined) return "missing";
  const comparisons = [
    ["min", (n, limit) => n >= limit],
    ["max", (n, limit) => n <= limit],
    ["equals", (n, limit) => n === limit],
  ];
  return comparisons.every(
    ([key, compare]) => rule[key] === undefined || compare(actual, rule[key]),
  )
    ? "passed"
    : "failed";
}
export function measuredMetrics(audit) {
  const checks = audit.checks || [];
  const fallback = {
    checks: checks.map((check) => ({
      ...check,
      format: check.reportFormat,
      metrics: check.thresholds,
    })),
  };
  const spec = audit.history || historySpecification(fallback);
  return {
    display: spec.display || [],
    metrics: spec.definitions.map((rule) => {
      const check = checks.find((item) => item.id === rule.check);
      const path = rule.path.replace(/\[(\d+)\]/g, ".$1");
      const actual = numeric(check?.metrics?.[path]);
      return {
        ...rule,
        ...bounds(rule),
        actual: actual ?? null,
        status: metricStatus(check, actual, rule),
      };
    }),
  };
}
