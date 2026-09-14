import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getAskTimeoutMs, loadConfig } from "./config.ts";
import { IntercomClient } from "./broker/client.ts";
import { spawnBrokerIfNeeded } from "./broker/spawn.ts";
import type { Message, SessionInfo, SessionRegistration } from "./types.ts";

export const DEFAULT_CLI_NAME = "pi-intercom-cli";
export const CLI_MODEL = "pi-intercom";

/**
 * The CLI is an ordinary intercom session: it describes itself with the same fields
 * every pi session reports, and the broker applies the same visibility and delivery
 * rules to it. Anything it wants delivered while it is not running goes through the
 * broker mailbox like any other offline participant.
 */
export function cliSessionRegistration(name: string = DEFAULT_CLI_NAME, cwd: string = process.cwd()): SessionRegistration {
  const now = Date.now();
  return { name, cwd, model: CLI_MODEL, pid: process.pid, startedAt: now, lastActivity: now };
}

function cliVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** Pull `--name <value>` (or `--name=<value>`) out of the arguments so every subcommand can share it. */
function takeNameFlag(args: string[]): { name: string; rest: string[] } {
  let name = DEFAULT_CLI_NAME;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--name") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--name requires a value");
      }
      name = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    rest.push(arg);
  }
  if (!name.trim()) {
    throw new Error("--name cannot be empty");
  }
  return { name: name.trim(), rest };
}

interface ReplyWaiter {
  promise: Promise<Message>;
  cancel: () => void;
}

function usage(): string {
  return [
    "Usage:",
    "  pi-intercom list",
    "  pi-intercom send <target> <message>",
    "  pi-intercom ask <target> <message> [--name <session name>]",
    "",
    "The CLI registers as an ordinary intercom session named \"pi-intercom-cli\" by",
    "default; pass --name to change it. Replies to its asks route back over the same",
    "connection, and the broker queues them if this process exits first.",
    "",
    "Flags:",
    "  --name <session name>       intercom name to register under (default pi-intercom-cli)",
    "",
    "Environment:",
    "  PI_INTERCOM_ASK_TIMEOUT_MS  ask timeout in milliseconds (default 600000)",
  ].join("\n");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function waitForReply(client: IntercomClient, replyTo: string, fromId: string, timeoutMs: number): ReplyWaiter {
  let cleanup: () => void = () => undefined;
  const promise = new Promise<Message>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`No reply from ${fromId} for message ${replyTo} within ${timeoutMs}ms`)));
    }, timeoutMs);

    const onMessage = (from: SessionInfo, message: Message) => {
      if (message.replyTo !== replyTo || from.id !== fromId) {
        return;
      }
      finish(() => resolve(message));
    };

    const onDisconnected = (error: Error) => {
      finish(() => reject(error));
    };

    cleanup = () => {
      clearTimeout(timer);
      client.off("message", onMessage);
      client.off("disconnected", onDisconnected);
    };

    client.on("message", onMessage);
    client.on("disconnected", onDisconnected);
  });

  return { promise, cancel: cleanup };
}

function resolveTarget(sessions: SessionInfo[], nameOrId: string): SessionInfo | null {
  const exactId = sessions.find((session) => session.id === nameOrId);
  if (exactId) {
    return exactId;
  }

  const lowerName = nameOrId.toLowerCase();
  const byName = sessions.filter((session) => session.name?.toLowerCase() === lowerName);
  if (byName.length === 1) {
    return byName[0]!;
  }

  const byPrefix = sessions.filter((session) => session.id.startsWith(nameOrId));
  if (byPrefix.length === 1) {
    return byPrefix[0]!;
  }

  if (byName.length > 1 || byPrefix.length > 1) {
    throw new Error(`Multiple sessions match "${nameOrId}"; use a full session ID`);
  }

  return null;
}

function formatSession(session: SessionInfo): string {
  const name = session.name || session.id.slice(0, 8);
  const status = session.status ? ` [${session.status}]` : "";
  return `${name} (${session.id})${status} - ${session.cwd} [${session.model}]`;
}

async function connectCliClient(name: string): Promise<IntercomClient> {
  const config = loadConfig();
  await spawnBrokerIfNeeded(config.brokerCommand, config.brokerArgs);
  const client = new IntercomClient();
  await client.connect(cliSessionRegistration(name));
  return client;
}

async function runList(client: IntercomClient): Promise<void> {
  const sessions = await client.listSessions();
  for (const session of sessions) {
    console.log(formatSession(session));
  }
}

async function runSend(client: IntercomClient, target: string, text: string): Promise<void> {
  const sessions = await client.listSessions();
  const resolved = resolveTarget(sessions, target);
  if (!resolved) {
    throw new Error(`Session "${target}" is not connected`);
  }
  if (resolved.id === client.sessionId) {
    throw new Error("Cannot message the CLI session itself");
  }

  const result = await client.send(resolved.id, { text });
  if (!result.delivered) {
    throw new Error(`Message to "${resolved.name || resolved.id}" was not delivered: ${result.reason ?? "unknown error"}`);
  }
  console.log(`Message sent to ${resolved.name || resolved.id} (${resolved.id})`);
}

async function runAsk(client: IntercomClient, target: string, text: string): Promise<void> {
  const sessions = await client.listSessions();
  const resolved = resolveTarget(sessions, target);
  if (!resolved) {
    throw new Error(`Session "${target}" is not connected`);
  }
  if (resolved.id === client.sessionId) {
    throw new Error("Cannot message the CLI session itself");
  }

  const messageId = randomUUID();
  const waiter = waitForReply(client, messageId, resolved.id, getAskTimeoutMs());
  try {
    const result = await client.send(resolved.id, {
      messageId,
      text,
      expectsReply: true,
    });
    if (!result.delivered) {
      throw new Error(`Message to "${resolved.name || resolved.id}" was not delivered: ${result.reason ?? "unknown error"}`);
    }
    const reply = await waiter.promise;
    console.log(reply.content.text);
  } finally {
    waiter.cancel();
  }
}

async function main(): Promise<number> {
  const { name, rest: args } = takeNameFlag(process.argv.slice(2));
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return 0;
  }
  if (args[0] === "--version") {
    console.log(`pi-intercom ${cliVersion()}`);
    return 0;
  }

  const [command, ...rest] = args;
  switch (command) {
    case "list": {
      if (rest.length > 0) {
        throw new Error("list does not accept arguments");
      }
      const client = await connectCliClient(name);
      try {
        await runList(client);
        return 0;
      } finally {
        await client.disconnect().catch(() => undefined);
      }
    }
    case "send": {
      if (rest.length < 2) {
        throw new Error("send requires <target> and <message>");
      }
      const client = await connectCliClient(name);
      try {
        await runSend(client, rest[0]!, rest.slice(1).join(" "));
        return 0;
      } finally {
        await client.disconnect().catch(() => undefined);
      }
    }
    case "ask": {
      if (rest.length < 2) {
        throw new Error("ask requires <target> and <message>");
      }
      const client = await connectCliClient(name);
      try {
        await runAsk(client, rest[0]!, rest.slice(1).join(" "));
        return 0;
      } finally {
        await client.disconnect().catch(() => undefined);
      }
    }
    default:
      throw new Error(`Unknown command "${command}"`);
  }
}

// Importing this module (from tests, or from another script) must not run the CLI.
const invokedAsScript = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`pi-intercom: ${toError(error).message}`);
      process.exitCode = 1;
    },
  );
}
