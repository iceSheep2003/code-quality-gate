function cell(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/[\r\n]+/g, " ");
}
function number(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
function metricText(check) {
  if (check.thresholds?.length)
    return check.thresholds
      .map((rule) => {
        const path = rule.path.replace(/\[(\d+)\]/g, ".$1");
        const actual = check.metrics?.[path];
        const limits = [
          ["min", ">="],
          ["max", "<="],
          ["equals", "="],
        ]
          .filter(([key]) => rule[key] !== undefined)
          .map(([key, op]) => `${op} ${rule[key]}`)
          .join(" and ");
        return `${rule.name}: ${typeof actual === "number" ? number(actual) : "missing"} (${limits})`;
      })
      .join("; ");
  return Object.entries(check.metrics || {})
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .slice(0, 8)
    .map(([name, value]) => `${name}=${number(value)}`)
    .join(", ");
}
function logs(check) {
  return (check.violations || [])
    .filter((violation) => violation.output)
    .map((violation) => {
      // Indented code keeps tool output inert, even when it contains Markdown fences.
      const output = violation.output
        .slice(0, 6000)
        .replace(/\u001b\[[0-9;]*m/g, "");
      return [
        ``,
        `### ${cell(check.title || check.id)}`,
        "",
        ...output
          .trimEnd()
          .split(/\r?\n/)
          .map((line) => "    " + line),
      ];
    })
    .flat();
}
function row(check) {
  const details =
    (check.violations || [])
      .map((violation) => cell(violation.message))
      .join("<br>") || "—";
  const status =
    check.status.toUpperCase() +
    (check.required === false ? " (optional)" : "");
  return `| ${cell(check.title || check.id)} | ${status} | ${cell(metricText(check)) || "—"} | ${details} |`;
}
function summaryLine(summary = {}) {
  const { passed = 0, failed = 0, errors = 0, blocking = 0 } = summary;
  return `**Summary:** ${passed} passed, ${failed} failed, ${errors} errors; ${blocking} blocking.`;
}
export function auditMarkdown(result) {
  const lines = [
    "# Code quality report",
    "",
    `**Status:** ${result.passed ? "PASS" : "FAIL"}`,
    "",
    "| Check | Status | Metrics | Details |",
    "| --- | --- | --- | --- |",
  ];
  for (const check of result.checks || []) lines.push(row(check));
  lines.push("", summaryLine(result.summary));
  for (const check of result.checks || []) lines.push(...logs(check));
  lines.push(
    "",
    "_Results apply to the executed checks and configured thresholds. They do not prove the absence of defects._",
  );
  return lines.join("\n") + "\n";
}
export function auditSarif(result) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "veritygate", version: "0.4.0" } },
        invocations: [
          {
            executionSuccessful: !(result.checks || []).some(
              (check) => check.status === "error",
            ),
          },
        ],
        results: (result.checks || []).flatMap((check) =>
          (check.violations || []).map((violation) => ({
            ruleId: `${check.id}:${violation.rule}`,
            level: check.required === false ? "warning" : "error",
            message: { text: `${check.title}: ${violation.message}` },
          })),
        ),
      },
    ],
  };
}
