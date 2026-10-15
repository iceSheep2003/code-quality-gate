import { spawn } from "node:child_process";
import { hash } from "./ast.mjs";
import {
  safeRelative,
  readJson,
  readSource,
  within,
  writeJson,
} from "./files.mjs";
const contractFields = [
  "id",
  "title",
  "requirements",
  "codeFiles",
  "kind",
  "review",
];
function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function validatePaths(paths) {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some(
      (p) => !safeRelative(p) || !/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(p),
    )
  )
    throw new Error(
      "Contract paths must name JavaScript files inside the project",
    );
}
function validateRequirement(r) {
  if (
    !r ||
    Object.keys(r).some(
      (k) => !["id", "given", "when", "then", "tests"].includes(k),
    ) ||
    ![r.id, r.given, r.when, r.then].every(nonempty)
  )
    throw new Error("Each requirement needs id, given, when and then");
  validatePaths(r.tests);
  if (r.tests.some((p) => !/\.test\.(?:m?js|cjs)$/.test(p)))
    throw new Error(
      "Requirements must point to Node .test.js/.test.mjs/.test.cjs tests",
    );
}
function validateKind(change) {
  if (
    change.kind !== undefined &&
    !["behavior", "refactor"].includes(change.kind)
  )
    throw new Error("Unknown change kind");
  if (change.kind === "refactor" && !nonempty(change.review))
    throw new Error("A refactor needs explicit maintainer review context");
}
export function validateChange(change) {
  if (
    !change ||
    Object.keys(change).some((k) => !contractFields.includes(k)) ||
    !nonempty(change.title) ||
    !/^[-\w]{1,80}$/.test(change.id || "")
  )
    throw new Error("Invalid business change contract");
  if (!Array.isArray(change.requirements) || !change.requirements.length)
    throw new Error("A business change requires testable acceptance criteria");
  validateKind(change);
  validatePaths(change.codeFiles);
  for (const r of change.requirements) validateRequirement(r);
  return change;
}
export async function changeDigests(root, change, allowMissingCode = false) {
  const tests = [
      ...new Set(change.requirements.flatMap((r) => r.tests)),
    ].sort(),
    files = [...new Set([...change.codeFiles, ...tests])].sort(),
    digests = {};
  for (const path of files) {
    try {
      digests[path] = hash(await readSource(root, path));
    } catch (error) {
      if (!allowMissingCode || tests.includes(path) || error.code !== "ENOENT")
        throw error;
      digests[path] = null;
    }
  }
  return { contract: hash(change), tests, files: digests };
}
function executeTests(root, paths) {
  return new Promise((resolveResult) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(
        process.execPath,
        ["--test", "--test-reporter=tap", ...paths],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      ),
      parts = [];
    let size = 0,
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 60000);
    const collect = (data) => {
      size += data.length;
      if (size > 500000) child.kill("SIGKILL");
      else parts.push(data);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () =>
      resolveResult({
        code: -1,
        output: "process unavailable",
        timedOut: true,
      }),
    );
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        code,
        output: Buffer.concat(parts).toString(),
        timedOut: timedOut || size > 500000,
      });
    });
  });
}
function phasePassed(phase, result) {
  if (result.timedOut) return false;
  const tests = Number(result.output.match(/^# tests (\d+)/m)?.[1] || 0);
  if (!tests || /^# (?:skipped|todo|cancelled) [1-9]\d*$/m.test(result.output))
    return false;
  if (phase === "green")
    return result.code === 0 && /^# fail 0$/m.test(result.output);
  return (
    result.code === 1 &&
    result.output.includes("ERR_ASSERTION") &&
    !/ERR_MODULE_NOT_FOUND|name: '(?:SyntaxError|ReferenceError|TypeError)'/.test(
      result.output,
    )
  );
}
function sameTests(red, current) {
  return (
    red.digests.contract === current.contract &&
    current.tests.every(
      (path) => red.digests.files[path] === current.files[path],
    )
  );
}
async function saveEvidence(root, change, record) {
  const path = ".quality-tdd/" + change.id + ".json";
  const existing = (await readJson(root, path, { optional: true })) || {
    version: 1,
    id: change.id,
  };
  await writeJson(root, path, { ...existing, [record.phase]: record });
}
async function preparePhase(root, change, phase) {
  const first = change.kind === "refactor" ? "baseline" : "red";
  if (phase !== "green" && phase !== first)
    return {
      passed: false,
      message: "Phase does not match the reviewed change kind",
    };
  const previous = await readJson(root, ".quality-tdd/" + change.id + ".json", {
    optional: true,
  });
  if (phase === "green" && !previous?.[first])
    return { passed: false, message: "Missing initial evidence" };
  const digests = await changeDigests(root, change, phase === "baseline");
  if (phase === "green" && !sameTests(previous[first], digests))
    return {
      passed: false,
      message:
        "Record the initial phase with the same requirements and tests first",
    };
  return { digests };
}
export async function recordPhase({ root, manifest, phase }) {
  if (!["red", "green", "baseline"].includes(phase))
    throw new Error("Phase must be red, green or reviewed refactor baseline");
  const change = validateChange(await readJson(root, manifest));
  const preparation = await preparePhase(root, change, phase);
  if (preparation.passed === false) return preparation;
  const { digests } = preparation;
  for (const path of digests.tests) await within(root, path);
  const result = await executeTests(root, digests.tests),
    passed = phasePassed(phase === "baseline" ? "green" : phase, result);
  if (!passed)
    return {
      passed: false,
      message:
        phase === "red"
          ? "Red needs a real failing assertion; loading errors and initially green tests do not qualify"
          : "Green requires all contract tests to pass",
    };
  const after = await changeDigests(root, change, phase === "baseline");
  if (hash(after) !== hash(digests))
    return {
      passed: false,
      message: "Source or tests changed during execution; run the phase again",
    };
  const record = { phase, time: new Date().toISOString(), digests };
  await saveEvidence(root, change, record);
  return { passed: true, phase, id: change.id };
}
export async function verifyEvidence({ root, manifest }) {
  const change = validateChange(await readJson(root, manifest)),
    evidence = await readJson(root, ".quality-tdd/" + change.id + ".json", {
      optional: true,
    });
  const first = change.kind === "refactor" ? "baseline" : "red";
  if (!evidence?.[first] || !evidence.green)
    return {
      passed: false,
      id: change.id,
      message: "Missing initial/final evidence",
    };
  const current = await changeDigests(root, change);
  const passed =
    sameTests(evidence[first], current) &&
    hash(evidence.green.digests) === hash(current) &&
    Date.parse(evidence.green.time) >= Date.parse(evidence[first].time);
  return {
    passed,
    id: change.id,
    codeFiles: change.codeFiles,
    message: passed
      ? "Current code and unchanged tests match green evidence"
      : "Code, tests or requirements changed after verification",
  };
}
