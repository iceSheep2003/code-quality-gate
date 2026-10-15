import { tool } from "../version.mjs";
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readSource, writeText, within } from "../files.mjs";
import { hash } from "../ast.mjs";
import { withWorkflowLock } from "../agent/lock.mjs";
import { measuredMetrics } from "./history-metrics.mjs";
import { historySource } from "./history-source.mjs";
import { historyMarkdown } from "./history-markdown.mjs";
const directory = ".quality/code-quality-gate";
const ledger = `${directory}/history.jsonl`;
async function readEntries(root) {
  let raw;
  try {
    raw = await readSource(root, ledger);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const entries = raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    validateChain(entries);
    return entries;
  } catch {
    throw new Error(
      "Quality history ledger is corrupt; preserve and recover it before appending",
    );
  }
}
function validateChain(entries) {
  let previousHash = null;
  for (const [index, entry] of entries.entries()) {
    const { recordHash, ...value } = entry;
    if (
      entry.schemaVersion !== 1 ||
      entry.sequence !== index + 1 ||
      entry.previousHash !== previousHash ||
      recordHash !== hash(value)
    )
      throw new Error("Invalid quality history chain");
    previousHash = recordHash;
  }
}
function checkFacts(audit) {
  return (audit.checks || []).map((check) => ({
    id: check.id,
    title: check.title,
    required: check.required !== false,
    status: check.status,
    exitCode: check.exitCode ?? null,
    durationMs: check.durationMs ?? null,
    details: (check.violations || [])
      .map((violation) => violation.message)
      .join("; "),
  }));
}
async function makeEntry(root, input, entries) {
  const sameTask = entries.filter((entry) => entry.task.id === input.task.id);
  const measurement = measuredMetrics(input.audit);
  const value = {
    schemaVersion: 1,
    tool: input.audit.tool || tool,
    sequence: entries.length + 1,
    iteration: sameTask.length + 1,
    runId: randomUUID(),
    timestamp: new Date().toISOString(),
    task: { id: input.task.id, title: input.task.title || input.task.id },
    phase: input.phase,
    accepted: input.accepted,
    auditPassed: input.audit.passed,
    canMerge: input.accepted && input.phase === "gate",
    note: input.note || "",
    message: input.message || "",
    source: await historySource(root, input.task, sameTask.at(-1)),
    metrics: measurement.metrics,
    displayMetrics: measurement.display,
    checks: checkFacts(input.audit),
    previousHash: entries.at(-1)?.recordHash || null,
  };
  return { ...value, recordHash: hash(value) };
}
async function appendHistory(root, input) {
  const entries = await readEntries(root);
  const entry = await makeEntry(root, input, entries);
  if (!entries.length) await writeText(root, ledger, "");
  await appendFile(await within(root, ledger), JSON.stringify(entry) + "\n");
  entries.push(entry);
  const markdown = `${directory}/history.md`;
  await writeText(root, markdown, historyMarkdown(entries));
  const taskMarkdown = `${directory}/${input.task.id}/history.md`;
  await writeText(
    root,
    taskMarkdown,
    historyMarkdown(entries.filter((item) => item.task.id === input.task.id)),
  );
  return {
    sequence: entry.sequence,
    iteration: entry.iteration,
    markdown,
    taskMarkdown,
    jsonl: ledger,
  };
}
export async function recordHistory(root, input) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.task.id))
    throw new Error("Invalid history task id");
  return withWorkflowLock(
    root,
    () => appendHistory(root, input),
    "history.lock",
  );
}
