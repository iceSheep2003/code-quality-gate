import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readJson, readSource, writeJson, writeText } from "../files.mjs";
import { hostWorkflow } from "./ci-template.mjs";
const begin = "<!-- code-quality-gate:start -->";
const end = "<!-- code-quality-gate:end -->";
const instructions = `${begin}\n## Code Quality Gate code-change workflow\nFor code changes, read .agents/skills/code-quality-gate/SKILL.md before editing implementation. Design a task testPlan before implementation: run acceptance and focused checks on green, defer expensive regression/coverage/mutation checks to the full gate when appropriate, and explain the scope. Preview with cqg plan <task>. Write acceptance tests, record a real red phase, implement and rerun the planned green checks until they pass, then run cqg gate before completion or any authorized merge. Keep tests, thresholds, adapters and evidence intact. Respect the user's scope and stop request. Reports are saved in .quality/code-quality-gate/. Open report.html for all tasks, iteration metrics and recorded diagnostics in one offline report. After each implementation iteration, supply a short --note and read history.md to compare measured metrics; never edit historical numeric facts.\n${end}`;
async function optionalText(root, path) {
  try {
    return await readSource(root, path);
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
async function managedInstructions(root, filename) {
  const existing = await optionalText(root, filename);
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end);
  if (start < 0 !== finish < 0)
    throw new Error(`Incomplete Code Quality Gate markers in ${filename}`);
  const value =
    start < 0
      ? `${existing.trimEnd()}\n\n${instructions}\n`.trimStart()
      : existing.slice(0, start) +
        instructions +
        existing.slice(finish + end.length);
  await writeText(root, filename, value);
}
async function skillFiles(root) {
  const skill = await readFile(
    new URL("../../skills/code-quality-gate/SKILL.md", import.meta.url),
    "utf8",
  );
  for (const path of [
    ".agents/skills/code-quality-gate/SKILL.md",
    ".claude/skills/code-quality-gate/SKILL.md",
  ]) {
    const current = await optionalText(root, path);
    if (current && current !== skill)
      throw new Error(`Existing customized skill requires review: ${path}`);
  }
  for (const path of [
    ".agents/skills/code-quality-gate/SKILL.md",
    ".claude/skills/code-quality-gate/SKILL.md",
  ])
    await writeText(root, path, skill);
}
async function mcpConfig(root) {
  const config = (await readJson(root, ".mcp.json", { optional: true })) || {};
  const command = {
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../cli.mjs", import.meta.url)),
      "mcp",
      "--root",
      root,
    ],
  };
  if (
    config.mcpServers?.["code-quality-gate"] &&
    JSON.stringify(config.mcpServers["code-quality-gate"]) !==
      JSON.stringify(command)
  )
    throw new Error("Existing Code Quality Gate MCP entry requires review");
  await writeJson(root, ".mcp.json", {
    ...config,
    mcpServers: { ...config.mcpServers, "code-quality-gate": command },
  });
}
async function appendIgnore(root) {
  const current = await optionalText(root, ".gitignore");
  const entries = [
    ".quality/",
    ".code-quality-gate/run.lock/",
    ".code-quality-gate/history.lock/",
    ".code-quality-gate/.gitkeep",
    ".mcp.json",
  ];
  const lines = new Set(current.split(/\r?\n/));
  const missing = entries.filter((entry) => !lines.has(entry));
  if (missing.length)
    await writeText(
      root,
      ".gitignore",
      `${current.trimEnd()}\n${missing.join("\n")}\n`.trimStart(),
    );
}
export async function setupAgent(root) {
  const config = await readJson(root, "quality.config.json", {
    optional: true,
  });
  if (!config)
    await writeJson(root, "quality.config.json", {
      version: 1,
      audit: { checks: [] },
    });
  await skillFiles(root);
  await managedInstructions(root, "AGENTS.md");
  await managedInstructions(root, "CLAUDE.md");
  await mcpConfig(root);
  const workflow = await optionalText(
    root,
    ".github/workflows/code-quality-gate.yml",
  );
  if (!workflow)
    await writeText(
      root,
      ".github/workflows/code-quality-gate.yml",
      hostWorkflow,
    );
  await appendIgnore(root);
  return {
    schemaVersion: 1,
    passed: true,
    message:
      "Installed agent instructions, discoverable skills, local MCP configuration and a CI gate workflow. The coding agent must configure real JUnit acceptance checks before recording red. No test or quality threshold was invented.",
  };
}
