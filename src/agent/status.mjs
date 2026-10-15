import { readJson } from "../files.mjs";
import { readConfig } from "../project.mjs";
export async function agentStatus(root) {
  const config = await readConfig(root);
  const latest = await readJson(
    root,
    ".quality/code-quality-gate/latest.json",
    {
      optional: true,
    },
  );
  const active = await readJson(root, ".code-quality-gate/active.json", {
    optional: true,
  });
  return {
    schemaVersion: 1,
    passed: true,
    active,
    latest,
    history: {
      markdown: ".quality/code-quality-gate/history.md",
      jsonl: ".quality/code-quality-gate/history.jsonl",
    },
    configuredChecks: (config.audit?.checks || []).map((check) => ({
      id: check.id,
      title: check.title,
      format: check.format,
      required: check.required !== false,
    })),
    nextAction: !active
      ? "Write acceptance tests and record red"
      : "Use the last report to choose the next action; run the final gate before merging",
    message:
      "Status is informational. Only a fresh successful gate authorizes the workflow's ready-to-merge result.",
  };
}
