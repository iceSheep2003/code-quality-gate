export function validateHistoryConfig(history, checks) {
  if (history === undefined) return;
  if (
    !history ||
    typeof history !== "object" ||
    Array.isArray(history) ||
    Object.keys(history).some((key) => key !== "metrics")
  )
    throw new Error("Invalid audit.history fields");
  const metrics = history.metrics ?? [];
  if (!Array.isArray(metrics) || metrics.length > 32)
    throw new Error("history.metrics must be an array of at most 32 columns");
  metrics.forEach((metric) => validateColumn(metric, checks));
  const keys = metrics.map((metric) => `${metric.check}:${metric.path}`);
  if (new Set(keys).size !== keys.length)
    throw new Error("History metric columns must be unique");
}
function validateColumn(metric, checks) {
  if (
    !metric ||
    typeof metric !== "object" ||
    Array.isArray(metric) ||
    Object.keys(metric).some((key) => !["check", "path", "label"].includes(key))
  )
    throw new Error("Invalid history metric column");
  if (
    ![metric.check, metric.path, metric.label].every(
      (value) => typeof value === "string" && value.trim(),
    )
  )
    throw new Error("History columns require check, path and label");
  if (!checks.some((check) => check.id === metric.check))
    throw new Error(`History metric references unknown check: ${metric.check}`);
}
