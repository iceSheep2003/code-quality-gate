#!/usr/bin/env node
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  readConfig,
  checkProject,
  analyzeProject,
  baselineProject,
} from "./project.mjs";
import { recordPhase, verifyEvidence } from "./tdd.mjs";
import { writeJson, within, safeRelative } from "./files.mjs";
import { formatReport } from "./reporters.mjs";
import { runAudit } from "./audit/engine.mjs";
import { auditMarkdown, auditSarif } from "./audit/markdown.mjs";
import { dispatchAgent } from "./agent/dispatch.mjs";
import { workflowMarkdown } from "./agent/artifacts.mjs";
const usage = `veritygate <setup|workflow|gate|status|mcp|audit|check|init|baseline|tdd|verify> [options]
  --root DIRECTORY       Project root (default: current directory)
  --config FILE          Relative JSON config (default: quality.config.json)
  --format FORMAT        audit/workflow/gate: markdown|json|sarif; others: text|json|sarif
  --json                 Alias for --format json
  --accept-existing      Explicitly record current findings as legacy (baseline)
  --change FILE          Task/contract (workflow/gate/tdd/verify)
  --phase red|green|baseline  Evidence phase (workflow: red|green; tdd: red|green|baseline)
  --help, -h             Show help
  --version, -v          Show version
check does not execute project code. audit runs configured tools; tdd runs Node tests.
Exit codes: 0 passed, 1 findings/evidence failed, 2 configuration or access error.`;
const commandFlags = {
  setup: ["root", "format"],
  workflow: ["root", "config", "manifest", "phase", "format"],
  gate: ["root", "config", "manifest", "format"],
  status: ["root", "format"],
  mcp: ["root"],
  check: ["root", "config", "format"],
  audit: ["root", "config", "format"],
  init: ["root", "config", "format"],
  baseline: ["root", "config", "format", "acceptExisting"],
  tdd: ["root", "manifest", "phase", "format"],
  verify: ["root", "manifest", "format"],
};
const valued = {
  "--root": "root",
  "--config": "config",
  "--format": "format",
  "--change": "manifest",
  "--phase": "phase",
};
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
  if (!valued[arg]) throw new Error("Unknown CLI argument: " + argv[index]);
  const value = rest.length ? inline : argv[++index];
  if (!value || value.startsWith("--"))
    throw new Error("Missing value for " + arg);
  result[valued[arg]] = value;
  given.push(valued[arg]);
  return index;
}
function validateOptions(result, given) {
  if (!commandFlags[result.command])
    throw new Error("Unknown command: " + result.command);
  if (given.some((flag) => !commandFlags[result.command].includes(flag)))
    throw new Error("Flag is not supported by " + result.command);
  const formats = ["audit", "workflow", "gate"].includes(result.command)
    ? ["markdown", "json", "sarif"]
    : ["text", "json", "sarif"];
  if (!formats.includes(result.format))
    throw new Error(`Format must be ${formats.join(", ")}`);
  if (
    ["tdd", "verify", "workflow"].includes(result.command) &&
    !result.manifest
  )
    throw new Error("--change is required");
  if (["tdd", "workflow"].includes(result.command) && !result.phase)
    throw new Error("--phase is required");
}
function options(argv) {
  const result = {
      command: argv[0] || "check",
      root: process.cwd(),
      format: ["audit", "workflow", "gate"].includes(argv[0])
        ? "markdown"
        : "text",
    },
    given = [];
  for (let i = 1; i < argv.length; i++) i = parseFlag(argv, i, result, given);
  validateOptions(result, given);
  return result;
}
async function loadConfig(root, opts) {
  if (opts.config) await within(root, opts.config);
  return readConfig(root, opts.config);
}
async function baseline(root, opts) {
  if (!opts.acceptExisting)
    throw new Error(
      "Baseline creation requires --accept-existing; inspect findings before accepting them",
    );
  const config = await loadConfig(root, opts),
    reports = await analyzeProject(root, config);
  if (!reports.length || reports.some((r) => r.parseErrors.length))
    throw new Error("Cannot baseline empty or unparseable sources");
  await writeJson(root, config.baseline, baselineProject(reports, config));
  return {
    schemaVersion: 1,
    passed: true,
    message:
      "Recorded existing findings. Future modified findings remain blocking.",
  };
}
async function init(root, opts) {
  const filename = opts.config || "quality.config.json";
  if (!safeRelative(filename) || filename.includes("/"))
    throw new Error("init config must be a filename at project root");
  await within(root, ".");
  const config = {
    version: 1,
    include: ["src"],
    requireTdd: false,
    dependencyCycles: true,
  };
  await writeFile(
    resolve(root, filename),
    JSON.stringify(config, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    schemaVersion: 1,
    passed: true,
    message:
      "Created " + filename + ". Set include to your production source paths.",
  };
}
async function dispatch(opts) {
  const root = resolve(opts.root);
  if (["setup", "workflow", "gate", "status", "mcp"].includes(opts.command))
    return dispatchAgent(root, opts);
  if (opts.command === "check")
    return checkProject(root, await loadConfig(root, opts));
  if (opts.command === "audit") {
    const config = await loadConfig(root, opts);
    return runAudit(root, config.audit || {});
  }
  if (opts.command === "baseline") return baseline(root, opts);
  if (opts.command === "init") return init(root, opts);
  if (opts.command === "tdd")
    return recordPhase({ root, manifest: opts.manifest, phase: opts.phase });
  return verifyEvidence({ root, manifest: opts.manifest });
}
const argv = process.argv.slice(2);
let format = argv.includes("--json")
  ? "json"
  : argv.find((x) => x.startsWith("--format="))?.slice(9) ||
    (argv.includes("--format")
      ? argv[argv.indexOf("--format") + 1]
      : undefined) ||
    (["audit", "workflow", "gate"].includes(argv[0]) ? "markdown" : "text");
try {
  if (argv.some((a) => ["--help", "-h"].includes(a))) console.log(usage);
  else if (argv.some((a) => ["--version", "-v"].includes(a)))
    console.log("0.4.0");
  else {
    const opts = options(argv);
    format = opts.format;
    const result = await dispatch(opts);
    if (result === null) {
      /* MCP owns stdout until its transport closes. */
    } else {
      const report = { schemaVersion: 1, ...result };
      console.log(
        format === "markdown"
          ? (result.phase
              ? workflowMarkdown(result)
              : auditMarkdown(report)
            ).trimEnd()
          : ["audit", "workflow", "gate"].includes(opts.command) &&
              format === "sarif"
            ? JSON.stringify(auditSarif(result.audit || report), null, 2)
            : formatReport(report, format),
      );
      process.exitCode = result.passed ? 0 : 1;
    }
  }
} catch (error) {
  const result = {
    schemaVersion: 1,
    passed: false,
    violations: [{ rule: "configuration", message: error.message }],
  };
  if (format === "markdown") {
    console.log(
      auditMarkdown({
        ...result,
        checks: [
          {
            id: "configuration",
            title: "Configuration",
            status: "error",
            required: true,
            violations: result.violations,
          },
        ],
        summary: { total: 1, passed: 0, failed: 0, errors: 1, blocking: 1 },
      }).trimEnd(),
    );
  } else if (!["json", "sarif"].includes(format)) {
    console.error(formatReport(result, "text"));
    console.error("Run veritygate --help for usage.");
  } else console.log(formatReport(result, format));
  process.exitCode = 2;
}
