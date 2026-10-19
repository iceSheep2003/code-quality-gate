import { recordHistory } from "../audit/history.mjs";
import { randomUUID } from "node:crypto";
import { auditMarkdown } from "../audit/markdown.mjs";
import { writeJson, writeText } from "../files.mjs";
export function failedAudit(rule, message) {
  return {
    passed: false,
    checks: [
      {
        id: "workflow",
        title: "Test-first workflow",
        status: "failed",
        required: true,
        violations: [{ rule, message }],
      },
    ],
    summary: { total: 1, passed: 0, failed: 1, errors: 0, blocking: 1 },
  };
}
function executionText(audit) {
  const plan = audit.execution;
  if (!plan) return "";
  return `**Execution scope:** ${plan.mode}\n\n**Executed checks:** ${plan.selectedChecks.join(", ")}\n\n**Deferred to final gate:** ${plan.deferredChecks.join(", ") || "none"}\n\n`;
}
export function workflowMarkdown(result) {
  return `# Code Quality Gate workflow\n\n**Phase:** ${result.phase}\n\n**Phase accepted:** ${result.passed ? "yes" : "no"}\n\n**Ready to merge:** ${result.canMerge ? "yes" : "no"}\n\n${result.message}\n\n**Iteration history:** ${result.history?.markdown || "not recorded"}\n\n${executionText(result.audit)}${auditMarkdown(result.audit)}`;
}
export async function saveIteration(
  root,
  task,
  { phase, audit, accepted, message, note },
) {
  audit = decisionAudit(audit, accepted, message);
  const prefix = `.quality/code-quality-gate/${task.id}/${phase}-${randomUUID()}`;
  const result = {
    schemaVersion: 1,
    id: task.id,
    phase,
    passed: accepted,
    canMerge: accepted && phase === "gate",
    message,
    report: `${prefix}.md`,
    audit,
  };
  result.history = await recordHistory(root, {
    task,
    phase,
    audit,
    accepted,
    message,
    note,
  });
  result.html = result.history.html;
  const markdown = workflowMarkdown(result);
  await writeText(root, result.report, markdown);
  await writeJson(root, `${prefix}.json`, result);
  await writeText(root, ".quality/code-quality-gate/latest.md", markdown);
  await writeJson(root, ".quality/code-quality-gate/latest.json", result);
  return result;
}
export async function rejected(root, task, phase, message) {
  return saveIteration(root, task, {
    phase: phase,
    audit: failedAudit("workflow", message),
    accepted: false,
    message: message,
  });
}

function decisionAudit(audit, accepted, message) {
  if (accepted || !audit.passed) return audit;
  const block = failedAudit("workflow", message);
  return {
    ...audit,
    passed: false,
    checks: [...audit.checks, ...block.checks],
    summary: {
      ...audit.summary,
      total: audit.summary.total + 1,
      failed: audit.summary.failed + 1,
      blocking: audit.summary.blocking + 1,
    },
  };
}
