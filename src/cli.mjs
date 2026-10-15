#!/usr/bin/env node
import { tool } from "./version.mjs";
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
import { runProjectAudit } from "./audit/project-audit.mjs";
import { auditMarkdown, auditSarif } from "./audit/markdown.mjs";
import { dispatchAgent } from "./agent/dispatch.mjs";
import { workflowMarkdown } from "./agent/artifacts.mjs";
import { usage, options, defaultFormat } from "./cli-options.mjs";
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
  if (opts.command === "audit") return runProjectAudit(root, opts);
  if (opts.command === "baseline") return baseline(root, opts);
  if (opts.command === "init") return init(root, opts);
  if (opts.command === "tdd")
    return recordPhase({ root, manifest: opts.manifest, phase: opts.phase });
  return verifyEvidence({ root, manifest: opts.manifest });
}
const argv = process.argv.slice(2);
let format = argv.includes("--json")
  ? "json"
  : argv
      .find((x) => /^(--format|-f)=/.test(x))
      ?.split("=")
      .slice(1)
      .join("=") ||
    (argv.includes("--format")
      ? argv[argv.indexOf("--format") + 1]
      : argv.includes("-f")
        ? argv[argv.indexOf("-f") + 1]
        : undefined) ||
    defaultFormat(argv[0]);
try {
  if (argv[0] === "help" || argv.some((a) => ["--help", "-h"].includes(a)))
    console.log(usage);
  else if (
    argv[0] === "version" ||
    argv.some((a) => ["--version", "-v"].includes(a))
  )
    console.log(tool.version);
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
    console.error("Run cqg help for usage.");
  } else console.log(formatReport(result, format));
  process.exitCode = 2;
}
