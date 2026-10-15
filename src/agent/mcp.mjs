import { tool } from "../version.mjs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { readJson, writeJson } from "../files.mjs";
import { runProjectAudit } from "../audit/project-audit.mjs";
import { runWorkflow, runGate } from "./workflow.mjs";
import { setupAgent } from "./setup.mjs";
import { agentStatus } from "./status.mjs";
import { validateTask } from "./contract.mjs";
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
  const manifest = `.code-quality-gate/tasks/${task.id}.json`;
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
  const server = new McpServer(tool, {
    instructions:
      "For code changes: inspect quality checks, write acceptance tests first, begin a task, record real failing assertions with code_quality_gate_red, implement and repeat code_quality_gate_green using its reports, then call code_quality_gate_gate before an authorized merge. Do not weaken tests, quality standards or evidence. Respect the user scope, stop requests and task budget. This server runs configured project tools and is not a sandbox.",
  });
  register(
    server,
    {
      name: "code_quality_gate_status",
      description:
        "Inspect checks, active task and last report; this is not a fresh merge decision",
      readOnly: true,
    },
    () => agentStatus(root),
  );
  register(
    server,
    {
      name: "code_quality_gate_setup",
      description:
        "Install managed agent instructions, discoverable skills and MCP configuration in this project",
    },
    () => setupAgent(root),
  );
  register(
    server,
    {
      name: "code_quality_gate_begin",
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
      name: "code_quality_gate_gate",
      description:
        "Fresh merge gate: verify red/green evidence and unchanged current files, rerun all quality checks; canMerge is true only on success",
      schema: { note: z.string().max(1000).optional() },
    },
    (args) => runGate({ root, note: args.note }),
  );
  register(
    server,
    {
      name: "code_quality_gate_audit",
      description:
        "Run independent diagnostics and append measured metrics to the iteration history; this does not replace red/green evidence",
      schema: { note: z.string().max(1000).optional() },
    },
    (args) => runProjectAudit(root, { note: args.note }),
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
        name: `code_quality_gate_${phase}`,
        description:
          phase === "red"
            ? "Record failing acceptance assertions before implementing; freezing tests and quality standards"
            : "Audit the implementation without changing frozen tests or standards; repeat using the generated report until passed or budget exhausted",
        schema: { manifest: z.string(), note: z.string().max(1000).optional() },
      },
      (args) =>
        runWorkflow({ root, manifest: args.manifest, phase, note: args.note }),
    );
}
