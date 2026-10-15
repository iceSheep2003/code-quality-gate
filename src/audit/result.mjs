export function finding(rule, message, location = {}) {
  return { rule, message, severity: "error", ...location };
}
export function result(id, findings = [], metrics = {}, status) {
  return {
    id,
    status: status || (findings.length ? "failed" : "passed"),
    findings,
    metrics,
  };
}
export function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error("Missing or invalid " + name);
  return value;
}
export function count(value, name) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error("Invalid " + name + " count");
  return value;
}
export function percentage(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 100)
    throw new Error("Invalid " + name + " percentage");
  return value;
}
