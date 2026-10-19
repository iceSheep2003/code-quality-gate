import { historySpecification } from "../audit/history-metrics.mjs";
import { runAudit } from "../audit/engine.mjs";

function acceptanceChecks(task, config) {
  return task.testChecks.map((id) => {
    const check = config.audit?.checks?.find((item) => item.id === id);
    if (!check || check.required === false || check.format !== "junit")
      throw new Error(
        `Acceptance check ${id} must be required and produce JUnit`,
      );
    return check;
  });
}
export function validateTestPlan(plan, acceptance) {
  if (plan === undefined) return;
  if (
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    Object.keys(plan).some(
      (key) => !["iterationChecks", "rationale"].includes(key),
    )
  )
    throw new Error("testPlan allows only iterationChecks and rationale");
  validateIterationChecks(plan.iterationChecks, acceptance);
  if (
    typeof plan.rationale !== "string" ||
    !plan.rationale.trim() ||
    plan.rationale.length > 2000
  )
    throw new Error(
      "testPlan.rationale must explain the scope in 1..2000 characters",
    );
}
function validateIterationChecks(ids, acceptance) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("testPlan.iterationChecks must contain unique check ids");
  if (acceptance.some((id) => !ids.includes(id)))
    throw new Error("Every acceptance testCheck must run in each iteration");
}
export function executionPlan(task, config, phase) {
  acceptanceChecks(task, config);
  const checks = config.audit?.checks || [];
  const ids = task.testPlan?.iterationChecks || checks.map((check) => check.id);
  for (const id of ids)
    if (!checks.some((check) => check.id === id))
      throw new Error(`Unknown test plan check: ${id}`);
  const selected = phaseChecks(task, checks, ids, phase);
  return {
    phase,
    mode: executionMode(task, phase),
    selectedChecks: checks
      .filter((check) => selected.includes(check.id))
      .map((check) => check.id),
    deferredChecks: checks
      .filter((check) => !selected.includes(check.id))
      .map((check) => check.id),
    rationale:
      task.testPlan?.rationale ||
      "No test plan configured; green and gate run all configured checks.",
  };
}
function phaseChecks(task, checks, iteration, phase) {
  if (phase === "red") return task.testChecks;
  if (phase === "green") return iteration;
  return checks.map((check) => check.id);
}
function executionMode(task, phase) {
  if (phase === "red") return "acceptance";
  return phase === "green" && task.testPlan ? "planned" : "full";
}
export async function runPlannedAudit(root, task, config, phase) {
  const execution = executionPlan(task, config, phase);
  const audit = await runAudit(root, {
    ...config.audit,
    checks: config.audit.checks.filter((check) =>
      execution.selectedChecks.includes(check.id),
    ),
    history: undefined,
  });
  audit.history = historySpecification(config.audit);
  audit.execution = execution;
  return audit;
}
