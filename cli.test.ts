import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { collectInboundMail, cliSessionRegistration, DEFAULT_CLI_NAME } from "./cli.ts";
import type { IntercomClient } from "./broker/client.ts";
import type { Message, SessionInfo } from "./types.ts";

function fakeClient(): IntercomClient & EventEmitter {
  return new EventEmitter() as IntercomClient & EventEmitter;
}

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "peer-session-0001",
    cwd: "/repo",
    model: "test-model",
    pid: 1,
    startedAt: 1,
    lastActivity: 1,
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "message-0001",
    timestamp: 1,
    content: { text: "hello from a peer" },
    ...overrides,
  } as Message;
}

/** Capture what the collector writes to stderr, since that is its user-visible output. */
function captureStderr(fn: () => void): string {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

test("collectInboundMail is attached before connect, so flushed mailbox mail is kept", () => {
  // The broker flushes a departed peer's mailbox immediately after "registered", and
  // those frames can be parsed before connect() resolves. A listener attached after the
  // await would miss them, and the broker has already removed them from its mailbox.
  const client = fakeClient();
  const inbound = collectInboundMail(client, DEFAULT_CLI_NAME);
  client.emit("message", session(), message({ id: "queued-reply", replyTo: "earlier-ask" }));

  const output = captureStderr(() => inbound.report());
  assert.match(output, /hello from a peer/);
  assert.match(output, /reply to earlier-ask/);
  assert.match(output, /not this command's output/);
});

test("collectInboundMail reports nothing when no mail arrived", () => {
  const client = fakeClient();
  const inbound = collectInboundMail(client, DEFAULT_CLI_NAME);
  assert.equal(captureStderr(() => inbound.report()), "");
});

test("collectInboundMail drops the message the command already handled", () => {
  const client = fakeClient();
  const inbound = collectInboundMail(client, DEFAULT_CLI_NAME);
  client.emit("message", session(), message({ id: "handled-reply" }));
  client.emit("message", session(), message({ id: "other-message", content: { text: "unrelated" } }));

  inbound.consume("handled-reply");
  const output = captureStderr(() => inbound.report());
  assert.equal(output.includes("hello from a peer"), false);
  assert.match(output, /unrelated/);
});

test("collectInboundMail does not report the same message twice", () => {
  const client = fakeClient();
  const inbound = collectInboundMail(client, DEFAULT_CLI_NAME);
  client.emit("message", session(), message());

  assert.notEqual(captureStderr(() => inbound.report()), "");
  assert.equal(captureStderr(() => inbound.report()), "");
});

test("cliSessionRegistration describes a CLI as an ordinary session", () => {
  const registration = cliSessionRegistration("worker-cli", "/repo");

  assert.equal(registration.name, "worker-cli");
  assert.equal(registration.cwd, "/repo");
  assert.equal(registration.model, "pi-intercom");
  assert.equal(registration.pid, process.pid);
  // No hidden/visibility field: the CLI is described the same way a pi session is, and
  // the broker decides visibility and delivery for everyone.
  assert.deepEqual(Object.keys(registration).sort(), ["cwd", "lastActivity", "model", "name", "pid", "startedAt"]);
  assert.equal(cliSessionRegistration().name, DEFAULT_CLI_NAME);
});
