import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { readJson, writeJson } from "../files.mjs";
import { readConfig } from "../project.mjs";
import { runAudit } from "../audit/engine.mjs";
import { runWorkflow, runGate } from "./workflow.mjs";
import { setupAgent } from "./setup.mjs";
import { agentStatus } from "./status.mjs";
import { validateTask } from "./contract.mjs";
import { saveIteration } from "./artifacts.mjs";
import { withWorkflowLock } from "./lock.mjs";

function response(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    isError: value.passed === false,
  };
}
function register(server, definition, action) {
  server.registerTool(
    definition.name,
    {
      description: definition.description,
      inputSchema: definition.schema || {},
      annotations: {
        readOnlyHint: Boolean(definition.readOnly),
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        return response(await action(args));
      } catch (error) {
        return response({ passed: false, error: error.message });
      }
    },
  );
}
async function beginTask(root, input) {
  const task = validateTask({ version: 1, ...input });
  const manifest = `.veritygate/tasks/${task.id}.json`;
  if (await readJson(root, manifest, { optional: true }))
    throw new Error(
      "Task already exists; preserve its original tests and budget",
    );
  await writeJson(root, manifest, task);
  return {
    passed: true,
    manifest,
    nextAction:
      "Record red after writing the acceptance tests, then implement and iterate green",
  };
}
const taskSchema = {
  id: z.string(),
  title: z.string(),
  requirements: z.array(z.string()).min(1),
  testFiles: z.array(z.string()).min(1),
  codeFiles: z.array(z.string()).min(1),
  testChecks: z.array(z.string()).min(1),
  protectedFiles: z.array(z.string()).optional(),
  maxAttempts: z.number().int().min(1).max(100).optional(),
};
export function createMcpServer(root) {
  const server = new McpServer(
    { name: "veritygate", version: "0.4.0" },
    {
      instructions:
        "For code changes: inspect quality checks, write acceptance tests first, begin a task, record real failing assertions with veritygate_red, implement and repeat veritygate_green using its reports, then call veritygate_gate before an authorized merge. Do not weaken tests, quality standards or evidence. Respect the user scope, stop requests and task budget. This server runs configured project tools and is not a sandbox.",
    },
  );
  register(
    server,
    {
      name: "veritygate_status",
      description:
        "Inspect checks, active task and last report; this is not a fresh merge decision",
      readOnly: true,
    },
    () => agentStatus(root),
  );
  register(
    server,
    {
      name: "veritygate_setup",
      description:
        "Install managed agent instructions, discoverable skills and MCP configuration in this project",
    },
    () => setupAgent(root),
  );
  register(
    server,
    {
      name: "veritygate_begin",
      description:
        "Declare a test-first change after writing the tests; preserves a unique task and iteration budget",
      schema: taskSchema,
    },
    (args) => withWorkflowLock(root, () => beginTask(root, args)),
  );
  registerPhases(server, root);
  register(
    server,
    {
      name: "veritygate_gate",
      description:
        "Fresh merge gate: verify red/green evidence and unchanged current files, rerun all quality checks; canMerge is true only on success",
    },
    () => runGate({ root }),
  );
  register(
    server,
    {
      name: "veritygate_audit",
      description:
        "Run independent diagnostics and save Markdown/JSON reports; this does not replace red/green evidence",
    },
    () => withWorkflowLock(root, () => independentAudit(root)),
  );
  return server;
}
export async function serveMcp(root) {
  const server = createMcpServer(root);
  await server.connect(new StdioServerTransport());
  return server;
}

function registerPhases(server, root) {
  for (const phase of ["red", "green"])
    register(
      server,
      {
        name: `veritygate_${phase}`,
        description:
          phase === "red"
            ? "Record failing acceptance assertions before implementing; freezing tests and quality standards"
            : "Audit the implementation without changing frozen tests or standards; repeat using the generated report until passed or budget exhausted",
        schema: { manifest: z.string() },
      },
      (args) => runWorkflow({ root, manifest: args.manifest, phase }),
    );
}

async function independentAudit(root) {
  const config = await readConfig(root);
  const audit = await runAudit(root, config.audit);
  return saveIteration(
    root,
    { id: "diagnostics" },
    {
      phase: "audit",
      audit,
      accepted: audit.passed,
      message: "Independent audit; run the final gate before merging",
    },
  );
}
