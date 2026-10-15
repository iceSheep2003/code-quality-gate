import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { within, writeText } from "../files.mjs";
export async function withWorkflowLock(root, operation) {
  await writeText(root, ".veritygate/.gitkeep", "");
  const path = join(await within(root, ".veritygate"), "run.lock");
  try {
    await mkdir(path);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Another workflow holds .veritygate/run.lock; after a crash, verify no run is active before removing the stale lock",
      );
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rmdir(path);
  }
}
