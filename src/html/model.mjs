import { metricKey } from "../audit/history-metrics.mjs";
export const escape = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export const text = (en, zh) =>
  `<span class="en">${escape(en)}</span><span class="zh">${escape(zh)}</span>`;
export const number = (value) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);
export function policy(metric) {
  return [
    ["min", "≥"],
    ["max", "≤"],
    ["equals", "="],
  ]
    .filter(([key]) => metric[key] !== undefined)
    .map(([key, sign]) => `${sign} ${metric[key]}`)
    .join(" · ");
}
export function badge(value) {
  const status = ["passed", "failed", "error", "missing", "not-run"].includes(
    value,
  )
    ? value
    : "neutral";
  return `<span class="badge ${status}">${escape(value)}</span>`;
}
export function decision(entry) {
  if (!entry.accepted) return "FAILED";
  if (entry.canMerge) return "MERGE READY";
  return `${entry.phase.toUpperCase()} accepted`;
}
export function fields(entries) {
  if (entries.at(-1)?.displayMetrics?.length)
    return entries.at(-1).displayMetrics.slice(0, 32);
  const all = new Map();
  for (const entry of entries)
    for (const metric of entry.metrics || [])
      all.set(metricKey(metric), metric);
  return [...all.values()].slice(0, 32);
}
export function findMetric(entry, field) {
  return entry.metrics?.find(
    (metric) => metricKey(metric) === metricKey(field),
  );
}
export function metricCell(metric) {
  if (!metric) return badge("not-run");
  const value = metric.actual === null ? metric.status : number(metric.actual);
  const status =
    metric.status === "passed" && !policy(metric) ? "measured" : metric.status;
  return `<strong class="metric-value ${escape(status)}">${escape(value)}</strong> <small>${escape(policy(metric))}</small> ${badge(status)}`;
}
export function normalizeAudit(result = {}) {
  if (result.audit) return result.audit;
  if (result.checks) return result;
  return {
    ...result,
    checks: (result.violations || []).map((item, index) => ({
      id: item.rule || item.metric || `finding-${index + 1}`,
      title:
        item.filename ||
        (item.rule === "configuration" ? "Configuration" : item.rule) ||
        "Configuration",
      status: "failed",
      required: true,
      violations: [
        {
          message:
            item.message ||
            `${item.metric}: ${item.actual}; limit ${item.limit}`,
        },
      ],
    })),
  };
}
export function rowData(entry) {
  return `data-filter-record data-task="${escape(entry.task.id)}" data-phase="${escape(entry.phase)}" data-outcome="${entry.accepted ? "accepted" : "failed"}" data-search="${escape([entry.task.id, entry.note, entry.message, ...(entry.source.changedFiles || [])].join(" ").toLowerCase())}"`;
}
