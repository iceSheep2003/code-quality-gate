import { readSource } from "../files.mjs";
import { hash } from "../ast.mjs";
import { runProcess } from "./process.mjs";
async function gitCommit(root) {
  try {
    const result = await runProcess(["git", "rev-parse", "HEAD"], {
      root,
      timeoutMs: 3000,
      maxOutputBytes: 1024,
    });
    return result.code === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}
export async function historySource(root, task, previous) {
  const files = {};
  for (const path of task.codeFiles || []) {
    try {
      files[path] = hash(await readSource(root, path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      files[path] = null;
    }
  }
  const before = previous?.source.files || {};
  const all = [
    ...new Set([...Object.keys(before), ...Object.keys(files)]),
  ].sort();
  const changedFiles = previous
    ? all.filter((path) => before[path] !== files[path])
    : [];
  return {
    commit: await gitCommit(root),
    fingerprint: Object.keys(files).length ? hash(files) : null,
    files,
    changedFiles,
    baseline: !previous,
    scope: Object.keys(files).length ? "declared-code-files" : "not-declared",
  };
}
