import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertNoLiveBroker,
  currentBrokerProcessIdentity,
  formatBrokerPidFile,
  parseBrokerPidFile,
} from "./runtime-claim.ts";

function withPidFile(contents: string, fn: (pidPath: string) => void): void {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-intercom-runtime-"));
  const pidPath = path.join(directory, "broker.pid");
  try {
    writeFileSync(pidPath, contents);
    fn(pidPath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("broker startup refuses to replace a live broker PID", () => {
  withPidFile(formatBrokerPidFile(currentBrokerProcessIdentity()), (pidPath) => {
    assert.throws(
      () => assertNoLiveBroker(pidPath),
      new RegExp(`Refusing to replace live intercom broker process ${process.pid}`),
    );
  });
});

test("broker startup tolerates a PID reused by an unrelated live process", { skip: process.platform !== "linux" }, () => {
  const identity = currentBrokerProcessIdentity();
  assert.ok(identity.bootId && identity.startTime, "expected Linux process identity to be readable");

  // Same pid, different kernel boot.
  withPidFile(formatBrokerPidFile({ ...identity, bootId: "00000000-0000-0000-0000-000000000000" }), (pidPath) => {
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));
  });

  // Same pid and boot, different process start time.
  withPidFile(formatBrokerPidFile({ ...identity, startTime: "1" }), (pidPath) => {
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));
  });
});

test("broker startup tolerates absent, invalid, and stale PID files", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pi-intercom-runtime-"));
  try {
    const pidPath = path.join(directory, "absent.pid");
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));

    writeFileSync(pidPath, "not-a-pid\n");
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));
    assert.equal(parseBrokerPidFile("not-a-pid\n"), null);

    // A dead pid is safe to replace whether or not it carries identity.
    writeFileSync(pidPath, "999999\n");
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));
    writeFileSync(pidPath, formatBrokerPidFile({ pid: 999999, bootId: "x", startTime: "1" }));
    assert.doesNotThrow(() => assertNoLiveBroker(pidPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("broker startup stays conservative for live PIDs without recorded identity", () => {
  // Old pid files, and platforms without /proc, must keep failing closed: a second
  // broker racing the live one is worse than asking a human to delete the file.
  withPidFile(`${process.pid}\n`, (pidPath) => {
    assert.throws(() => assertNoLiveBroker(pidPath), /Refusing to replace live intercom broker process/);
  });
});

test("pid file round-trips identity and reads the legacy single-line format", () => {
  const identity = currentBrokerProcessIdentity();
  assert.deepEqual(parseBrokerPidFile(formatBrokerPidFile(identity)), identity);

  assert.deepEqual(parseBrokerPidFile("1234\n"), { pid: 1234 });
  assert.deepEqual(parseBrokerPidFile("1234"), { pid: 1234 });
});
