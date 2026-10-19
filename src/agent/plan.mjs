import { readConfig } from "../project.mjs";
import { loadTask } from "./contract.mjs";
import { activeTask } from "./workflow.mjs";
import { executionPlan } from "./test-plan.mjs";

export async function inspectTestPlan({ root, manifest, config }) {
  const active = await activeTask(root, manifest, config);
  if (!active) throw new Error("No active task; use cqg plan <task>");
  const task = await loadTask(root, active.manifest);
  const settings = await readConfig(root, active.config);
  const phases = ["red", "green", "gate"].map((phase) =>
    executionPlan(task, settings, phase),
  );
  return {
    schemaVersion: 1,
    passed: true,
    canMerge: false,
    id: task.id,
    testPlan: task.testPlan || null,
    phases,
    message:
      phases[1].rationale +
      "\n\n" +
      phases
        .map(
          (plan) =>
            `${plan.phase}: ${plan.selectedChecks.join(", ")}\nDeferred: ${plan.deferredChecks.join(", ") || "none"}`,
        )
        .join("\n\n") +
      "\n\nPreview only; no checks were executed. The final gate always runs all configured checks.",
  };
}
