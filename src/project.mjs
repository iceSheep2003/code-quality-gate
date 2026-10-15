import { tool } from "./version.mjs";
import { validateAudit } from "./audit/config.mjs";
import { readdir } from "node:fs/promises";
import { analyzeSource } from "./analyzer.mjs";
import { createBaseline, evaluateReport, validateLimits } from "./policy.mjs";
import {
  discover,
  readJson,
  readSource,
  safeRelative,
  within,
  defaultExcludes,
} from "./files.mjs";
import { verifyEvidence } from "./tdd.mjs";
import { dependencyCycles } from "./dependencies.mjs";
const fields = [
  "version",
  "include",
  "exclude",
  "limits",
  "baseline",
  "contractsDirectory",
  "requireTdd",
  "dependencyCycles",
  "audit",
];
function paths(value, name, allowEmpty = false) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.some((p) => !safeRelative(p))
  )
    throw new Error(name + " must contain project-relative paths or globs");
}
function validateInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !fields.includes(k))
  )
    throw new Error("Unknown quality configuration field");
  if (input.version !== undefined && input.version !== 1)
    throw new Error("Unsupported configuration version");
}
export function resolveConfig(input = {}) {
  validateInput(input);
  if (input.audit !== undefined) validateAudit(input.audit);
  const config = {
    version: 1,
    include: ["."],
    exclude: defaultExcludes,
    baseline: "quality.baseline.json",
    contractsDirectory: "quality/changes",
    requireTdd: false,
    dependencyCycles: true,
    ...input,
  };
  paths(config.include, "include");
  paths(config.exclude, "exclude", true);
  if (
    !safeRelative(config.baseline) ||
    !safeRelative(config.contractsDirectory)
  )
    throw new Error("Quality paths must stay inside the project");
  if (
    typeof config.requireTdd !== "boolean" ||
    typeof config.dependencyCycles !== "boolean"
  )
    throw new Error("requireTdd and dependencyCycles must be booleans");
  config.limits = validateLimits(config.limits);
  return config;
}
export async function readConfig(root, filename = "quality.config.json") {
  const input = await readJson(root, filename, {
    optional: filename === "quality.config.json",
  });
  return resolveConfig(input ?? {});
}
export async function analyzeProject(root, config) {
  const files = await discover(root, config.include, config.exclude),
    reports = [];
  for (const filename of files)
    reports.push(analyzeSource(await readSource(root, filename), { filename }));
  if (config.dependencyCycles) {
    for (const finding of dependencyCycles(reports)) {
      reports
        .find((r) => r.filename === finding.filename)
        .findings.push(finding);
    }
  }
  return reports;
}
export function baselineProject(reports, config) {
  return {
    ...createBaseline(reports, config),
    files: reports.map((r) => ({
      filename: r.filename,
      fingerprint: r.files.fingerprint,
    })),
    scope: {
      include: config.include,
      exclude: config.exclude,
      dependencyCycles: config.dependencyCycles,
    },
  };
}
function changedFiles(reports, baseline) {
  const files = new Map(
    (baseline?.files || []).map((f) => [f.filename, f.fingerprint]),
  );
  return reports
    .filter((r) => files.get(r.filename) !== r.files.fingerprint)
    .map((r) => r.filename);
}
async function contractResults(root, config) {
  let items;
  try {
    items = await readdir(await within(root, config.contractsDirectory));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const results = [];
  for (const item of items.filter((p) => p.endsWith(".json")).sort())
    results.push(
      await verifyEvidence({
        root,
        manifest: config.contractsDirectory + "/" + item,
      }),
    );
  return results;
}
async function checkContracts(root, config, changed) {
  if (!config.requireTdd || !changed.length) return [];
  const results = await contractResults(root, config),
    covered = new Set(
      results.filter((r) => r.passed).flatMap((r) => r.codeFiles),
    );
  return changed
    .filter((f) => !covered.has(f))
    .map((filename) => ({
      filename,
      rule: "tdd-evidence",
      message:
        "Changed source requires a matching requirement and red/green or reviewed refactor record",
    }));
}
export async function checkProject(root, requested = {}) {
  const config = resolveConfig(requested),
    reports = await analyzeProject(root, config),
    baseline = await readJson(root, config.baseline, { optional: true });
  if (
    baseline?.scope &&
    JSON.stringify(baseline.scope) !==
      JSON.stringify({
        include: config.include,
        exclude: config.exclude,
        dependencyCycles: config.dependencyCycles,
      })
  )
    throw new Error(
      "Baseline scope no longer matches configuration; review scope changes before creating a new baseline",
    );
  const result = evaluateReport(reports, { baseline, limits: config.limits });
  const changed = changedFiles(reports, baseline),
    contracts = await checkContracts(root, config, changed);
  return {
    schemaVersion: 1,
    tool,
    ...result,
    passed: result.passed && contracts.length === 0,
    changedFiles: changed,
    violations: [...result.violations, ...contracts],
  };
}
