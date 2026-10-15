import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readJson, readSource, writeJson, writeText } from "../files.mjs";
import { hostWorkflow } from "./ci-template.mjs";
const begin = "<!-- veritygate:start -->";
const end = "<!-- veritygate:end -->";
const instructions = `${begin}\n## VerityGate code-change workflow\nFor code changes, read .agents/skills/veritygate/SKILL.md before editing implementation. Write acceptance tests, record a real red phase, implement and rerun green until all required checks pass, then run veritygate gate before completion or any authorized merge. Keep tests, thresholds, adapters and evidence intact. Respect the user's scope and stop request. Reports are saved in .quality/veritygate/.\n${end}`;
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
    throw new Error(`Incomplete VerityGate markers in ${filename}`);
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
    new URL("../../skills/veritygate/SKILL.md", import.meta.url),
    "utf8",
  );
  for (const path of [
    ".agents/skills/veritygate/SKILL.md",
    ".claude/skills/veritygate/SKILL.md",
  ]) {
    const current = await optionalText(root, path);
    if (current && current !== skill)
      throw new Error(`Existing customized skill requires review: ${path}`);
  }
  for (const path of [
    ".agents/skills/veritygate/SKILL.md",
    ".claude/skills/veritygate/SKILL.md",
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
    config.mcpServers?.veritygate &&
    JSON.stringify(config.mcpServers.veritygate) !== JSON.stringify(command)
  )
    throw new Error("Existing VerityGate MCP entry requires review");
  await writeJson(root, ".mcp.json", {
    ...config,
    mcpServers: { ...config.mcpServers, veritygate: command },
  });
}
async function appendIgnore(root) {
  const current = await optionalText(root, ".gitignore");
  const entries = [
    ".quality/",
    ".veritygate/run.lock/",
    ".veritygate/.gitkeep",
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
  const workflow = await optionalText(root, ".github/workflows/veritygate.yml");
  if (!workflow)
    await writeText(root, ".github/workflows/veritygate.yml", hostWorkflow);
  await appendIgnore(root);
  return {
    schemaVersion: 1,
    passed: true,
    message:
      "Installed agent instructions, discoverable skills, local MCP configuration and a CI gate workflow. The coding agent must configure real JUnit acceptance checks before recording red. No test or quality threshold was invented.",
  };
}
