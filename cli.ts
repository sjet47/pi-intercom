import { randomUUID } from "node:crypto";
import { getAskTimeoutMs, loadConfig } from "./config.ts";
import { IntercomClient } from "./broker/client.ts";
import { spawnBrokerIfNeeded } from "./broker/spawn.ts";
import type { Message, SessionInfo } from "./types.ts";

const CLI_NAME = "anomaly";
const SEND_NAME = "noreply";
const ASK_NAME = "anomaly";
const CLI_MODEL = "pi-intercom";
const CLI_VERSION = "0.10.0";

interface ReplyWaiter {
  promise: Promise<Message>;
  cancel: () => void;
}

function usage(): string {
  return [
    "Usage:",
    "  pi-intercom list",
    "  pi-intercom send <target> <message>",
    "  pi-intercom ask <target> <message>",
    "",
    "The CLI connects hidden. send uses the name \"noreply\" so ordinary",
    "sessions cannot reply; ask uses the name \"anomaly\" and remains replyable",
    "through the normal reply flow.",
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
  const hidden = session.hidden ? " hidden" : "";
  return `${name} (${session.id})${status}${hidden} - ${session.cwd} [${session.model}]`;
}

async function connectHiddenClient(name: string): Promise<IntercomClient> {
  const config = loadConfig();
  await spawnBrokerIfNeeded(config.brokerCommand, config.brokerArgs);
  const client = new IntercomClient();
  await client.connect({
    name,
    cwd: process.cwd(),
    model: CLI_MODEL,
    pid: process.pid,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    hidden: true,
  });
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
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return 0;
  }
  if (args[0] === "--version") {
    console.log(`pi-intercom ${CLI_VERSION}`);
    return 0;
  }

  const [command, ...rest] = args;
  switch (command) {
    case "list": {
      if (rest.length > 0) {
        throw new Error("list does not accept arguments");
      }
      const client = await connectHiddenClient(CLI_NAME);
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
      const client = await connectHiddenClient(SEND_NAME);
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
      const client = await connectHiddenClient(ASK_NAME);
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

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`pi-intercom: ${toError(error).message}`);
    process.exitCode = 1;
  },
);
