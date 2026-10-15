import { spawn } from "node:child_process";
function kill(child) {
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    /* process already exited */
  }
}
export function runProcess(
  argv,
  { root, timeoutMs = 60000, maxOutputBytes = 5000000 } = {},
) {
  return new Promise((resolve, reject) => {
    const command = argv[0] === "node" ? process.execPath : argv[0];
    const child = spawn(command, argv.slice(1), {
      cwd: root,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let bytes = 0,
      reason;
    const timer = setTimeout(() => {
      reason = "Process timed out";
      kill(child);
    }, timeoutMs);
    function collect(parts, data) {
      bytes += data.length;
      if (bytes > maxOutputBytes) {
        reason = "Process output limit exceeded";
        kill(child);
      } else parts.push(data);
    }
    child.stdout.on("data", (data) => collect(stdout, data));
    child.stderr.on("data", (data) => collect(stderr, data));
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Unable to execute configured tool: " + command));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (reason) return reject(new Error(reason));
      if (signal)
        return reject(new Error("Process terminated by signal " + signal));
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}
