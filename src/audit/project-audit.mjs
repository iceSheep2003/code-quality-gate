import { readConfig } from "../project.mjs";
import { runAudit } from "./engine.mjs";
import { saveIteration } from "../agent/artifacts.mjs";
import { withWorkflowLock } from "../agent/lock.mjs";
export async function runProjectAudit(root, options = {}) {
  return withWorkflowLock(root, async () => {
    const config = await readConfig(root, options.config);
    const audit = await runAudit(root, config.audit);
    const result = await saveIteration(
      root,
      { id: "diagnostics", title: "Independent audit" },
      {
        phase: "audit",
        audit,
        accepted: audit.passed,
        message: "Independent audit; run the final gate before merging",
        note: options.note,
      },
    );
    return { ...audit, report: result.report, history: result.history };
  });
}
