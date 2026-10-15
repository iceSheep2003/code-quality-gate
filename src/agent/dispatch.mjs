import { setupAgent } from "./setup.mjs";
import { runWorkflow, runGate } from "./workflow.mjs";
import { agentStatus } from "./status.mjs";
export async function dispatchAgent(root, opts) {
  if (opts.command === "setup") return setupAgent(root);
  if (opts.command === "status") return agentStatus(root);
  if (opts.command === "workflow")
    return runWorkflow({
      root,
      manifest: opts.manifest,
      phase: opts.phase,
      config: opts.config,
    });
  if (opts.command === "gate")
    return runGate({ root, manifest: opts.manifest, config: opts.config });
  const { serveMcp } = await import("./mcp.mjs");
  await serveMcp(root);
  return null;
}
