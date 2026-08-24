import { existsSync, readFileSync } from "node:fs";

function linuxProcessCommandLine(pid: number): string | null {
  try {
    // A PID can be reused by a thread of an unrelated process. /proc/<pid>/status
    // exposes the owning process (Tgid), and that process's command line is the
    // reliable way to tell whether this pid file really belongs to a broker.
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const tgid = /^Tgid:\s*(\d+)/m.exec(status)?.[1];
    const processPid = tgid ? Number.parseInt(tgid, 10) : pid;
    if (!Number.isSafeInteger(processPid) || processPid <= 0) return null;
    return readFileSync(`/proc/${processPid}/cmdline`, "utf8").replace(/\0/g, " ");
  } catch {
    return null;
  }
}

export function assertNoLiveBroker(pidPath: string, expectedProcessMarker = "broker.ts"): void {
  if (!existsSync(pidPath)) return;

  let pid: number;
  try {
    pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return;

  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }

  if (process.platform === "linux") {
    const commandLine = linuxProcessCommandLine(pid);
    if (commandLine !== null && !commandLine.includes(expectedProcessMarker)) {
      return;
    }
  }
  throw new Error(`Refusing to replace live intercom broker process ${pid}`);
}
