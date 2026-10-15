export const usage = `cqg <command> [options]

Agent workflow
  cqg setup                Connect this project to your coding agent
  cqg mcp [directory]      Start the MCP server (default: current directory)
  cqg red <task>           Record failing acceptance tests
  cqg green [task]         Check the implementation (default: active task)
  cqg gate [task]          Run the final gate before merging
  cqg status               Show workflow status
  cqg audit                Run configured tools and save reports/history

Static checks and compatibility
  cqg check                Run built-in JS/TS static checks
  cqg init                 Create a static-check configuration
  cqg baseline             Record reviewed legacy findings
  cqg workflow             Explicit --change FILE --phase red|green
  cqg tdd                  Node-only evidence: --change FILE --phase red|green|baseline
  cqg verify               Verify Node-only evidence: --change FILE
  cqg help                 Show this help
  cqg version              Show the installed version

Options
  -C, --root DIRECTORY     Project root (default: current directory)
  -c, --config FILE        Relative JSON config (default: quality.config.json)
  -f, --format FORMAT      audit/red/green/workflow/gate: markdown|json|sarif;
                           other commands: text|json|sarif
      --json               Alias for --format json
  -n, --note TEXT          Record an implementation-change note
      --change FILE        Explicit task/contract path
      --phase PHASE        Evidence phase for workflow or tdd
      --accept-existing    Explicitly accept reviewed findings (baseline)
  -h, --help               Show help
  -v, --version            Show version

Tasks are IDs in .code-quality-gate/tasks/ or project-relative manifest paths.
All commands also work as code-quality-gate or code-quality.
check does not execute project code. audit runs configured tools; tdd runs Node tests.
Exit codes: 0 passed, 1 checks/evidence failed, 2 configuration or access error.`;

const workflowFlags = ["root", "config", "manifest", "format", "note"];
const commandFlags = {
  setup: ["root", "format"],
  red: workflowFlags,
  green: workflowFlags,
  workflow: [...workflowFlags, "phase"],
  gate: workflowFlags,
  status: ["root", "format"],
  mcp: ["root"],
  check: ["root", "config", "format"],
  audit: ["root", "config", "format", "note"],
  init: ["root", "config", "format"],
  baseline: ["root", "config", "format", "acceptExisting"],
  tdd: ["root", "manifest", "phase", "format"],
  verify: ["root", "manifest", "format"],
};
const valued = {
  "-C": "root",
  "--root": "root",
  "-c": "config",
  "--config": "config",
  "-f": "format",
  "--format": "format",
  "--change": "manifest",
  "--phase": "phase",
  "-n": "note",
  "--note": "note",
};
export function defaultFormat(command) {
  return ["audit", "red", "green", "workflow", "gate"].includes(command)
    ? "markdown"
    : "text";
}
function parseFlag(argv, index, result, given) {
  const [arg, ...rest] = argv[index].split("="),
    inline = rest.join("=");
  if (arg === "--json" && !rest.length) {
    result.format = "json";
    given.push("format");
    return index;
  }
  if (arg === "--accept-existing" && !rest.length) {
    result.acceptExisting = true;
    given.push("acceptExisting");
    return index;
  }
  if (!Object.hasOwn(valued, arg))
    throw new Error("Unknown CLI argument: " + argv[index]);
  const value = rest.length ? inline : argv[++index];
  if (!value || value.startsWith("-"))
    throw new Error("Missing value for " + arg);
  result[valued[arg]] = value;
  given.push(valued[arg]);
  return index;
}
function positional(result, value, given) {
  const key = result.command === "mcp" ? "root" : "manifest";
  if (!["mcp", "red", "green", "gate"].includes(result.command))
    throw new Error("Unexpected CLI argument: " + value);
  if (given.includes(key)) throw new Error(key + " was specified twice");
  result[key] =
    key === "manifest" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
      ? `.code-quality-gate/tasks/${value}.json`
      : value;
  given.push(key);
}
function validateOptions(result, given) {
  if (!Object.hasOwn(commandFlags, result.command))
    throw new Error("Unknown command: " + result.command);
  if (given.some((flag) => !commandFlags[result.command].includes(flag)))
    throw new Error("Flag is not supported by " + result.command);
  if (new Set(given).size !== given.length)
    throw new Error("An option was specified twice");
  validateFormat(result);
  if (
    ["tdd", "verify", "workflow", "red"].includes(result.command) &&
    !result.manifest
  )
    throw new Error(
      result.command === "red" ? "Run cqg red <task>" : "--change is required",
    );
  if (["tdd", "workflow"].includes(result.command) && !result.phase)
    throw new Error("--phase is required");
}
export function options(argv) {
  const command = argv[0] || "check";
  const result = {
      command,
      root: process.cwd(),
      format: defaultFormat(command),
    },
    given = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("-")) i = parseFlag(argv, i, result, given);
    else positional(result, argv[i], given);
  }
  validateOptions(result, given);
  if (["red", "green"].includes(command)) {
    result.command = "workflow";
    result.phase = command;
  }
  return result;
}
function validateFormat(result) {
  if (result.note?.length > 1000)
    throw new Error("--note must be at most 1000 characters");
  const formats =
    defaultFormat(result.command) === "markdown"
      ? ["markdown", "json", "sarif"]
      : ["text", "json", "sarif"];
  if (!formats.includes(result.format))
    throw new Error(`Format must be ${formats.join(", ")}`);
}
