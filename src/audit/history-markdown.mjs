import { metricKey } from "./history-metrics.mjs";
function cell(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/[\r\n]+/g, " ");
}
function decision(entry) {
  if (!entry.accepted) return "FAILED";
  if (entry.canMerge) return "MERGE READY";
  return `${entry.phase.toUpperCase()} accepted`;
}
function sourceText(entry) {
  if (entry.source.fingerprint) return entry.source.fingerprint.slice(0, 12);
  return entry.source.commit
    ? `commit ${entry.source.commit.slice(0, 12)} (working files not declared)`
    : "not declared";
}
function metricText(metric) {
  if (!metric) return "not-run";
  if (metric.actual === null) return metric.status;
  const actual = Number.isInteger(metric.actual)
    ? String(metric.actual)
    : metric.actual.toFixed(2);
  const policy = [
    ["min", ">="],
    ["max", "<="],
    ["equals", "="],
  ]
    .filter(([key]) => metric[key] !== undefined)
    .map(([key, operator]) => `${operator} ${metric[key]}`)
    .join(" and ");
  return `${actual}${policy ? ` (${policy})` : ""}${metric.status === "failed" ? " FAIL" : ""}`;
}
function columns(entries) {
  const latest = entries.at(-1);
  if (latest?.displayMetrics.length) return latest.displayMetrics;
  const all = new Map();
  for (const entry of entries)
    for (const metric of entry.metrics) all.set(metricKey(metric), metric);
  return [...all.values()].slice(0, 32);
}
function executionText(entry) {
  const plan = entry.audit?.execution;
  if (!plan) return "—";
  return `${plan.mode}: ${plan.selectedChecks.join(", ")}; deferred: ${plan.deferredChecks.join(", ") || "none"}`;
}
function iterationRows(entries) {
  return entries.map((entry) => {
    const changes = entry.source.baseline
      ? "baseline"
      : entry.source.changedFiles.join(", ") || "none";
    return `| ${entry.sequence} | ${cell(entry.timestamp)} | ${cell(entry.task.id)} | ${cell(entry.phase)} | ${cell(sourceText(entry))} | ${cell(changes)} | ${decision(entry)} | ${cell(executionText(entry))} | ${cell(entry.note || entry.message)} |`;
  });
}
function metricTable(entries) {
  const fields = columns(entries);
  if (!fields.length)
    return [
      "No numeric metrics are configured. Check execution results are recorded below.",
    ];
  const header = `| # | ${fields.map((field) => cell(field.label || metricKey(field))).join(" | ")} |`;
  const separator = `| --- | ${fields.map(() => "---").join(" | ")} |`;
  const rows = entries.map(
    (entry) =>
      `| ${entry.sequence} | ${fields.map((field) => cell(metricText(entry.metrics.find((metric) => metricKey(metric) === metricKey(field))))).join(" | ")} |`,
  );
  return [header, separator, ...rows];
}
function checkRows(entries) {
  return entries.flatMap((entry) =>
    entry.checks.map(
      (check) =>
        `| ${entry.sequence} | ${cell(check.id)} | ${cell(check.status)} | ${check.required ? "yes" : "no"} | ${check.exitCode ?? "—"} | ${check.durationMs ?? "—"} | ${cell(check.details)} |`,
    ),
  );
}
export function historyMarkdown(entries) {
  return [
    "# Code Quality Gate iteration history",
    "",
    "Recorded observations are appended by the tool. Agent notes describe intent; numeric values come from executed checks.",
    "",
    "## Iterations",
    "",
    "| # | Time (UTC) | Task | Phase | Code fingerprint | Changed files since prior task iteration | Decision | Test plan | Note |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...iterationRows(entries),
    "",
    "## Metric history",
    "",
    ...metricTable(entries),
    "",
    "## Check execution",
    "",
    "| # | Check | Status | Required | Exit code | Duration (ms) | Details |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...checkRows(entries),
    "",
    "The metric table displays at most 32 selected/default columns; all recorded threshold measurements remain in JSONL.",
    "",
    "Missing, error and not-run are distinct from zero. Bounds shown in each cell are the policy for that iteration. Full fingerprints and a consistency hash chain are kept in history.jsonl.",
    "",
  ].join("\n");
}
