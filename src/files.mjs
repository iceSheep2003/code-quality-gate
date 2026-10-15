import {
  readFile,
  readdir,
  realpath,
  mkdir,
  lstat,
  writeFile,
} from "node:fs/promises";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { minimatch } from "minimatch";
export const extensions = [
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "mts",
  "cts",
  "tsx",
];
export const defaultExcludes = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.quality-tdd/**",
  "**/*.d.ts",
  "**/*.d.mts",
  "**/*.d.cts",
  "**/*.test.*",
  "**/*.spec.*",
  "tests/**",
  "test/**",
];
export function safeRelative(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:|^\\\\|\\/.test(path) &&
    !path.split(/[\\/]/).includes("..") &&
    !path.includes("\u0000")
  );
}
export async function within(root, path) {
  if (!safeRelative(path))
    throw new Error("Path must stay inside the project: " + path);
  const base = await realpath(root),
    actual = await realpath(resolve(base, path)),
    rel = relative(base, actual);
  if (
    rel === ".." ||
    rel.startsWith(".." + "/") ||
    rel.startsWith(".." + "\\") ||
    isAbsolute(rel)
  )
    throw new Error("Symlink leaves the project");
  return actual;
}
export async function readJson(root, path, { optional = false } = {}) {
  try {
    return JSON.parse(await readFile(await within(root, path), "utf8"));
  } catch (e) {
    if (optional && e.code === "ENOENT") return null;
    throw e;
  }
}
function matches(path, pattern) {
  return (
    pattern === "." ||
    path === pattern ||
    path.startsWith(pattern.replace(/\/$/, "") + "/") ||
    minimatch(path, pattern, { dot: true })
  );
}
function relevant(path, include) {
  return include.some(
    (p) =>
      matches(path, p) ||
      p.startsWith(path + "/") ||
      minimatch(path, p, { partial: true, dot: true }),
  );
}
async function walk(root, directory, include, exclude) {
  const path = await within(root, directory),
    items = await readdir(path, { withFileTypes: true }),
    files = [];
  for (const item of items) {
    const child = (directory === "." ? "" : directory + "/") + item.name;
    if (!relevant(child, include)) continue;
    if (
      exclude.some(
        (p) =>
          matches(child, p) || (item.isDirectory() && matches(child + "/", p)),
      )
    )
      continue;
    if (item.isDirectory())
      files.push(...(await walk(root, child, include, exclude)));
    else if (
      item.isFile() &&
      extensions.some((ext) => item.name.endsWith("." + ext))
    )
      files.push(child);
    else if (item.isSymbolicLink())
      throw new Error("Source symlinks are not supported: " + child);
  }
  return files;
}
export async function discover(root, include, exclude = defaultExcludes) {
  for (const entry of include) {
    if (!safeRelative(entry)) throw new Error("Invalid source scope");
    if (!/[*?\[\]{}]/.test(entry)) await within(root, entry);
  }
  const files = await walk(root, ".", include, exclude);
  return files.filter((path) => include.some((p) => matches(path, p))).sort();
}
export async function readSource(root, path) {
  return readFile(await within(root, path), "utf8");
}
async function rejectSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Evidence cannot overwrite symlinks");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
export async function writeJson(root, path, value) {
  return writeText(root, path, JSON.stringify(value, null, 2) + "\n");
}
export async function writeText(root, path, value) {
  if (!safeRelative(path))
    throw new Error("Output path must stay inside the project");
  const directory = dirname(path);
  await prepareDirectory(root, directory);
  await within(root, directory);
  const output = resolve(root, path);
  await rejectSymlink(output);
  await writeFile(output, value);
}
async function prepareDirectory(root, directory) {
  let current = ".";
  await within(root, current);
  for (const part of directory.split(/[\\/]/).filter((p) => p && p !== ".")) {
    current += "/" + part;
    const path = resolve(root, current);
    await rejectSymlink(path);
    try {
      await mkdir(path);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await within(root, current);
  }
}
