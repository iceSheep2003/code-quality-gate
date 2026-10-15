import { runAudit } from "../audit/engine.mjs";
import { readConfig } from "../project.mjs";
import { hash } from "../ast.mjs";
import { readJson, writeJson } from "../files.mjs";
import { loadTask, recordPath, snapshot, sameProtection } from "./contract.mjs";
import { rejected, saveIteration } from "./artifacts.mjs";
import { withWorkflowLock } from "./lock.mjs";

function acceptanceChecks(task, config) {
  return task.testChecks.map((id) => {
    const check = config.audit?.checks?.find((item) => item.id === id);
    if (!check || check.required === false || check.format !== "junit")
      throw new Error(
        `Acceptance check ${id} must be required and produce JUnit`,
      );
    return check;
  });
}
function redMetrics(metrics) {
  return (
    metrics.assertionFailures > 0 &&
    metrics.errors === 0 &&
    metrics.tests > 0 &&
    metrics.skipped === 0 &&
    metrics.loadingErrors === 0
  );
}
function isRealRed(audit) {
  return (
    audit.checks.length > 0 &&
    audit.checks.every(
      (check) =>
        check.status === "failed" &&
        check.exitCode !== 0 &&
        redMetrics(check.metrics || {}),
    )
  );
}
async function context(root, manifest, filename) {
  const task = await loadTask(root, manifest);
  const config = await readConfig(root, filename);
  acceptanceChecks(task, config);
  const options = { manifest, config: filename };
  const current = await snapshot(root, task, options);
  const evidence = await readJson(root, recordPath(task.id), {
    optional: true,
  });
  return { task, config, options, current, evidence };
}
async function red(root, ctx) {
  const { task, config, options, current, evidence } = ctx;
  if (evidence?.red)
    return rejected(
      root,
      task,
      "red",
      "Red evidence already exists; preserve the original tests and continue green",
    );
  const audit = await runAudit(root, {
    ...config.audit,
    checks: acceptanceChecks(task, config),
  });
  const after = await snapshot(root, task, options);
  const accepted = isRealRed(audit) && hash(current) === hash(after);
  const result = await saveIteration(root, task, {
    phase: "red",
    audit: audit,
    accepted: accepted,
    message: accepted
      ? "Failing assertions recorded; implement the behavior without changing the tests or standards"
      : "Red needs failing assertions, no loading errors/skips, and unchanged files during execution",
  });
  if (accepted) {
    await writeJson(root, recordPath(task.id), {
      version: 1,
      id: task.id,
      attempts: 0,
      red: {
        time: new Date().toISOString(),
        snapshot: current,
        report: result.report,
      },
    });
    await writeJson(root, ".veritygate/active.json", {
      manifest: options.manifest,
      config: options.config,
    });
  }
  return result;
}
async function green(root, ctx) {
  const { task, config, options, current, evidence } = ctx;
  if (!evidence?.red)
    return rejected(
      root,
      task,
      "green",
      "Record real failing tests before implementing the behavior",
    );
  if (!sameProtection(evidence.red.snapshot, current))
    return rejected(
      root,
      task,
      "green",
      "Tests, requirements, adapters or quality configuration changed after red",
    );
  if (evidence.attempts >= task.maxAttempts)
    return rejected(
      root,
      task,
      "green",
      "Attempt budget exhausted; keep the failure report and request revised requirements or budget",
    );
  const next = { ...evidence, attempts: evidence.attempts + 1 };
  delete next.green;
  await writeJson(root, recordPath(task.id), next);
  const audit = await runAudit(root, config.audit);
  const after = await snapshot(root, task, options);
  const accepted =
    audit.passed &&
    hash(current) === hash(after) &&
    hash(current.code) !== hash(evidence.red.snapshot.code);
  const result = await saveIteration(root, task, {
    phase: "green",
    audit: audit,
    accepted: accepted,
    message: accepted
      ? "All required checks passed; run the final gate before merging"
      : "Implementation must change from red, pass all checks, and remain unchanged while checks run",
  });
  if (accepted)
    await writeJson(root, recordPath(task.id), {
      ...next,
      green: {
        time: new Date().toISOString(),
        snapshot: after,
        report: result.report,
      },
    });
  return result;
}
export async function runWorkflow(options) {
  return withWorkflowLock(options.root, () => executeWorkflow(options));
}
async function executeWorkflow({
  root,
  manifest,
  phase,
  config = "quality.config.json",
}) {
  if (!["red", "green"].includes(phase))
    throw new Error("Workflow phase must be red or green");
  const ctx = await context(root, manifest, config);
  return phase === "red" ? red(root, ctx) : green(root, ctx);
}
export async function runGate(options) {
  return withWorkflowLock(options.root, () => executeGate(options));
}
async function executeGate({ root, manifest, config }) {
  const active = await activeTask(root, manifest, config);
  if (!active)
    return rejected(
      root,
      { id: "uninitialized" },
      "gate",
      "No active task; record red and green before merging",
    );
  const ctx = await context(root, active.manifest, active.config);
  const { task, evidence, current, options } = ctx;
  if (!evidence?.red || !evidence.green)
    return rejected(
      root,
      task,
      "gate",
      "Both red and green evidence are required",
    );
  if (
    !sameProtection(evidence.red.snapshot, current) ||
    hash(evidence.green.snapshot) !== hash(current)
  )
    return rejected(
      root,
      task,
      "gate",
      "Code, tests or quality standards changed after green; rerun the workflow",
    );
  const audit = await runAudit(root, ctx.config.audit);
  const after = await snapshot(root, task, options);
  const accepted = audit.passed && hash(current) === hash(after);
  return saveIteration(root, task, {
    phase: "gate",
    audit: audit,
    accepted: accepted,
    message: accepted
      ? "Current implementation passed a fresh final audit"
      : "Final audit failed or files changed during the audit",
  });
}

async function activeTask(root, manifest, config) {
  if (manifest) return { manifest, config: config || "quality.config.json" };
  return readJson(root, ".veritygate/active.json", { optional: true });
}
