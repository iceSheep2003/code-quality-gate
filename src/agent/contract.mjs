import { readJson, readSource, safeRelative } from "../files.mjs";
import { hash } from "../ast.mjs";

function paths(value, name, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length))
    throw new Error(
      `${name} must be an array of explicit project-relative files`,
    );
  if (value.some((file) => !safeRelative(file) || /[*?\[\]{}]/.test(file)))
    throw new Error(`Invalid ${name} path; globs are not supported`);
  return [...new Set(value)].sort();
}
export function validateTask(input) {
  const fields = [
    "version",
    "id",
    "title",
    "requirements",
    "testFiles",
    "codeFiles",
    "testChecks",
    "protectedFiles",
    "maxAttempts",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    throw new Error("Invalid task fields");
  if (
    input.version !== 1 ||
    typeof input.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.id)
  )
    throw new Error("Task requires version 1 and a safe id");
  if (typeof input.title !== "string" || !input.title.trim())
    throw new Error("Task title is required");
  validateRequirements(input.requirements);
  return normalizeTask(input);
}
function normalizeTask(input) {
  const testFiles = paths(input.testFiles, "testFiles");
  const codeFiles = paths(input.codeFiles, "codeFiles");
  if (testFiles.some((file) => codeFiles.includes(file)))
    throw new Error("Test and implementation files must be distinct");
  const testChecks = input.testChecks;
  if (
    !Array.isArray(testChecks) ||
    !testChecks.length ||
    testChecks.some((id) => typeof id !== "string" || !id.trim())
  )
    throw new Error("testChecks must identify acceptance checks");
  const maxAttempts = input.maxAttempts ?? 12;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100)
    throw new Error("maxAttempts must be 1..100");
  return {
    ...input,
    testFiles,
    codeFiles,
    testChecks: [...new Set(testChecks)],
    protectedFiles: paths(input.protectedFiles || [], "protectedFiles", true),
    maxAttempts,
  };
}
export async function loadTask(root, manifest) {
  return validateTask(await readJson(root, manifest));
}
async function digests(root, files, allowMissing) {
  const result = {};
  for (const file of files) {
    try {
      result[file] = hash(await readSource(root, file));
    } catch (error) {
      if (!allowMissing || error.code !== "ENOENT") throw error;
      result[file] = null;
    }
  }
  return result;
}
export async function snapshot(root, task, options) {
  const locked = [
    ...new Set([
      ...task.testFiles,
      ...task.protectedFiles,
      options.manifest,
      options.config,
    ]),
  ].sort();
  return {
    contract: hash(task),
    protected: await digests(root, locked, false),
    code: await digests(root, task.codeFiles, true),
  };
}
export function sameProtection(first, current) {
  return (
    hash({ contract: first.contract, protected: first.protected }) ===
    hash({ contract: current.contract, protected: current.protected })
  );
}
export function recordPath(id) {
  return `.code-quality-gate/evidence/${id}.json`;
}

function validateRequirements(requirements) {
  if (
    !Array.isArray(requirements) ||
    !requirements.length ||
    requirements.some((item) => typeof item !== "string" || !item.trim())
  )
    throw new Error("Task requires testable requirement descriptions");
}
