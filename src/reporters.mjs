import { tool } from "./version.mjs";
function violationText(v) {
  return `${v.filename || "<gate>"}:${v.line || 1}:${v.column || 1} ${v.rule || v.metric} ${v.message || `${v.actual} exceeds ${v.limit}`}`;
}
export function formatText(result) {
  const lines = [result.passed ? "Code quality: PASS" : "Code quality: FAIL"];
  if (result.message) lines.push(result.message);
  if (result.summary)
    lines.push(
      `${result.summary.files} files, ${result.summary.functions} functions, ${result.summary.legacyViolations} legacy findings`,
    );
  for (const v of result.violations || []) lines.push(violationText(v));
  return lines.join("\n");
}
export function toSarif(result) {
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: { driver: tool },
        invocations: [
          {
            executionSuccessful: !result.violations?.some(
              (v) => v.rule === "configuration",
            ),
          },
        ],
        results: (result.violations || []).map((v) => ({
          ruleId: v.rule || v.metric,
          level: "error",
          message: {
            text: v.message || `${v.metric}: ${v.actual} exceeds ${v.limit}`,
          },
          ...(v.filename
            ? {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: {
                        uri: v.filename
                          .split("/")
                          .map(encodeURIComponent)
                          .join("/"),
                        uriBaseId: "%SRCROOT%",
                      },
                      region: {
                        startLine: v.line || 1,
                        startColumn: v.column || 1,
                      },
                    },
                  },
                ],
              }
            : {}),
          ...(v.fingerprint
            ? { partialFingerprints: { "source/v1": v.fingerprint } }
            : {}),
        })),
      },
    ],
  };
}
export function formatReport(result, format = "text") {
  if (format === "text") return formatText(result);
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "sarif") return JSON.stringify(toSarif(result), null, 2);
  throw new Error("Unknown report format: " + format);
}
