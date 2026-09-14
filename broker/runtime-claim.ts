import { existsSync, readFileSync } from "node:fs";

/**
 * Identity recorded in the broker pid file.
 *
 * A pid alone is not a stable identity: after the broker dies without cleaning up,
 * the kernel can hand that pid to any unrelated process, and a bare `kill(pid, 0)`
 * liveness probe then refuses to replace a broker that is not actually running.
 * The boot id and process start time pin the file to one specific process, so the
 * startup check answers "is the process that wrote this file still alive?" instead
 * of "is this pid alive?".
 */
export interface BrokerProcessIdentity {
  pid: number;
  /** Kernel boot id. Only available on Linux. */
  bootId?: string;
  /** Process start time, in clock ticks since boot. Field 22 of `/proc/<pid>/stat`. Only available on Linux. */
  startTime?: string;
}

function readBootId(): string | null {
  try {
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    return bootId.length > 0 ? bootId : null;
  } catch {
    return null;
  }
}

function readProcessStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Only the comm field (field 2) may contain spaces and parentheses, and every
    // field after it is numeric, so the last ")" delimits the comm field.
    const close = stat.lastIndexOf(")");
    if (close === -1) return null;
    // Index 0 here is field 3 (state), so field 22 (starttime) is index 19.
    const startTime = stat.slice(close + 2).split(" ")[19];
    return startTime && /^\d+$/.test(startTime) ? startTime : null;
  } catch {
    return null;
  }
}

export function currentBrokerProcessIdentity(pid: number = process.pid): BrokerProcessIdentity {
  const bootId = readBootId();
  const startTime = readProcessStartTime(pid);
  return {
    pid,
    ...(bootId ? { bootId } : {}),
    ...(startTime ? { startTime } : {}),
  };
}

export function formatBrokerPidFile(identity: BrokerProcessIdentity): string {
  return `${identity.pid}\n${identity.bootId ?? ""}\n${identity.startTime ?? ""}\n`;
}

export function parseBrokerPidFile(contents: string): BrokerProcessIdentity | null {
  const [pidLine, bootIdLine, startTimeLine] = contents.split("\n");
  const pid = Number.parseInt((pidLine ?? "").trim(), 10);
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const bootId = bootIdLine?.trim();
  const startTime = startTimeLine?.trim();
  return {
    pid,
    ...(bootId ? { bootId } : {}),
    ...(startTime ? { startTime } : {}),
  };
}

/**
 * Refuse to replace a broker that is still running.
 *
 * Returns when the pid file is absent, unparsable, describes a dead process, or
 * describes a process that is alive but is provably not the broker that wrote the
 * file. Throws when a live broker cannot be ruled out, which keeps the check
 * conservative: losing the broker to a racing second instance is worse than
 * requiring a human to delete one stale pid file.
 */
export function assertNoLiveBroker(pidPath: string): void {
  if (!existsSync(pidPath)) return;

  let identity: BrokerProcessIdentity | null;
  try {
    identity = parseBrokerPidFile(readFileSync(pidPath, "utf8"));
  } catch {
    return;
  }
  if (!identity) return;

  try {
    process.kill(identity.pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }

  if (identity.bootId && identity.startTime) {
    const liveBootId = readBootId();
    const liveStartTime = readProcessStartTime(identity.pid);
    if (liveBootId === null || liveStartTime === null) {
      // The recorded process is alive but its identity is unreadable: refuse rather
      // than risk starting a second broker against the same socket.
      throw new Error(`Refusing to replace live intercom broker process ${identity.pid}`);
    }
    if (liveBootId !== identity.bootId || liveStartTime !== identity.startTime) {
      return;
    }
  }

  throw new Error(`Refusing to replace live intercom broker process ${identity.pid}`);
}
