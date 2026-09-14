#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirror broker/spawn.ts getTsxCliPath(): resolve the tsx package main entry (its
// "exports" field does not expose dist/cli.mjs as a subpath) and locate cli.mjs next
// to it, then fall back to the flat plugin-store layout and the nested layout.
function resolveTsxCli() {
  try {
    const requireFromRoot = createRequire(join(root, "package.json"));
    return join(dirname(requireFromRoot.resolve("tsx")), "cli.mjs");
  } catch {
    // Fall through to the filesystem layouts below.
  }
  const siblingTsxCli = join(root, "..", "tsx", "dist", "cli.mjs");
  if (existsSync(siblingTsxCli)) {
    return siblingTsxCli;
  }
  const nestedTsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  return existsSync(nestedTsxCli) ? nestedTsxCli : null;
}

const tsxCli = resolveTsxCli();
if (!tsxCli) {
  console.error("pi-intercom: cannot resolve the tsx CLI; run `npm install` in the package directory.");
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, join(root, "cli.ts"), ...process.argv.slice(2)], {
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
