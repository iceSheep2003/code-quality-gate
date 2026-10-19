import { inspectTestPlan } from "./plan.mjs";
import { setupAgent } from "./setup.mjs";
import { runWorkflow, runGate } from "./workflow.mjs";
import { agentStatus } from "./status.mjs";
export async function dispatchAgent(root, opts) {
  if (opts.command === "setup") return setupAgent(root);
  if (opts.command === "plan")
    return inspectTestPlan({
      root,
      manifest: opts.manifest,
      config: opts.config,
    });
  if (opts.command === "status") return agentStatus(root);
  if (opts.command === "workflow")
    return runWorkflow({
      root,
      manifest: opts.manifest,
      phase: opts.phase,
      note: opts.note,
      config: opts.config,
    });
  if (opts.command === "gate")
    return runGate({
      root,
      manifest: opts.manifest,
      config: opts.config,
      note: opts.note,
    });
  const { serveMcp } = await import("./mcp.mjs");
  await serveMcp(root);
  return null;
}
