import { validateHistoryConfig } from "./history-config.mjs";
import { safeRelative } from "../files.mjs";

function object(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(`Unknown ${label} field`);
}
function limit(value, name, min, max) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}: expected integer ${min}..${max}`);
}
function executionLimits(value) {
  limit(value.timeoutMs, "timeoutMs", 10, 600000);
  limit(value.maxOutputBytes, "maxOutputBytes", 1024, 100000000);
  limit(value.maxReportBytes, "maxReportBytes", 1024, 100000000);
}
function validateMetric(metric) {
  object(metric, ["name", "path", "min", "max", "equals"], "audit metric");
  for (const key of ["name", "path"])
    if (typeof metric[key] !== "string" || !metric[key].trim())
      throw new Error(`audit metric ${key} is required`);
  const operators = ["min", "max", "equals"].filter(
    (key) => metric[key] !== undefined,
  );
  if (!operators.length)
    throw new Error("audit metric requires min, max or equals");
  for (const key of operators)
    if (!Number.isFinite(metric[key])) throw new Error(`Invalid metric ${key}`);
  if (metric.min > metric.max)
    throw new Error("audit metric min cannot exceed max");
}
function validateReport(check) {
  if (check.report !== undefined && !safeRelative(check.report))
    throw new Error("Report path must stay inside project");
  if (
    check.format !== undefined &&
    !["json", "junit", "lcov", "text"].includes(check.format)
  )
    throw new Error("Unsupported audit report format");
  if (check.format !== undefined && !check.report)
    throw new Error("audit check format requires a report");
  validateMetrics(check);
}
function validateMetrics(check) {
  if (check.metrics === undefined) return;
  if (!Array.isArray(check.metrics))
    throw new Error("audit metrics must be an array");
  if (check.metrics.length && (!check.report || check.format === "text"))
    throw new Error("Metric thresholds require a structured report");
  check.metrics.forEach(validateMetric);
}
function validateCheck(check) {
  object(
    check,
    [
      "id",
      "title",
      "command",
      "report",
      "format",
      "required",
      "timeoutMs",
      "maxOutputBytes",
      "maxReportBytes",
      "metrics",
    ],
    "audit check",
  );
  if (
    typeof check.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(check.id)
  )
    throw new Error("audit check id must be a safe name");
  if (typeof check.title !== "string" || !check.title.trim())
    throw new Error("audit check title is required");
  validateCommand(check.command);
  if (check.required !== undefined && typeof check.required !== "boolean")
    throw new Error("audit check required must be boolean");
  executionLimits(check);
  validateReport(check);
}
function validateCommand(command) {
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((arg) => typeof arg !== "string" || arg.includes("\0")) ||
    !command[0].trim()
  )
    throw new Error("command must be a nonempty argv array");
}
export function validateAudit(input = {}) {
  object(
    input,
    ["checks", "timeoutMs", "maxOutputBytes", "maxReportBytes", "history"],
    "audit",
  );
  const checks = input.checks ?? [];
  if (!Array.isArray(checks)) throw new Error("audit.checks must be an array");
  checks.forEach(validateCheck);
  if (new Set(checks.map((check) => check.id)).size !== checks.length)
    throw new Error("audit check ids must be unique");
  executionLimits(input);
  validateHistoryConfig(input.history, checks);
  return {
    timeoutMs: 60000,
    maxOutputBytes: 5000000,
    maxReportBytes: 10000000,
    ...input,
    checks,
  };
}
