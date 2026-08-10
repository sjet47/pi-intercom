#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli");
} catch {
  try {
    const tsxMain = require.resolve("tsx");
    tsxCli = join(dirname(tsxMain), "cli.mjs");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pi-intercom: cannot resolve tsx CLI: ${message}`);
    process.exit(1);
  }
}

const cliPath = join(root, "cli.ts");
const child = spawn(process.execPath, [tsxCli, cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
};
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("error", (error) => {
  console.error(`pi-intercom: failed to launch: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
