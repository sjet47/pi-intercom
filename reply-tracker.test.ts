import test from "node:test";
import assert from "node:assert/strict";
import { ReplyTracker } from "./reply-tracker.ts";
import type { Message, SessionInfo } from "./types.ts";

function createSession(id: string, name: string): SessionInfo {
  return {
    id,
    name,
    cwd: "/tmp/project",
    model: "test-model",
    pid: 1,
    startedAt: 1,
    lastActivity: 1,
  };
}

function createMessage(id: string, text: string, expectsReply = true): Message {
  return {
    id,
    timestamp: 1,
    expectsReply,
    content: { text },
  };
}

test("reply resolves from current triggered message context", () => {
  const tracker = new ReplyTracker();
  const from = createSession("planner-id", "planner");
  const message = createMessage("ask-1", "Need a decision");

  const context = tracker.recordIncomingMessage(from, message, 1000);
  tracker.queueTurnContext(context);
  tracker.beginTurn(1001);

  assert.equal(tracker.resolveReplyTarget({}, 1002).message.id, "ask-1");
  assert.equal(tracker.resolveReplyTarget({}, 1002).from.id, "planner-id");
});

test("reply resolves from single pending ask without current turn context", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("planner-id", "planner"), createMessage("ask-1", "Need a decision"), 1000);

  assert.equal(tracker.resolveReplyTarget({}, 1001).message.id, "ask-1");
});

test("reply with to resolves matching pending ask", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("planner-id", "planner"), createMessage("ask-1", "First"), 1000);
  tracker.recordIncomingMessage(createSession("reviewer-id", "reviewer"), createMessage("ask-2", "Second"), 1001);

  assert.equal(tracker.resolveReplyTarget({ to: "reviewer" }, 1002).message.id, "ask-2");
  assert.equal(tracker.resolveReplyTarget({ to: "planner-id" }, 1002).message.id, "ask-1");
});

test("reply with to prefers matching pending ask over non-matching current turn context", () => {
  const tracker = new ReplyTracker();
  const contextA = tracker.recordIncomingMessage(createSession("a-id", "session-a"), createMessage("ask-a", "From A"), 1000);
  tracker.recordIncomingMessage(createSession("b-id", "session-b"), createMessage("ask-b", "From B"), 1001);
  tracker.queueTurnContext(contextA);
  tracker.beginTurn(1002);

  const target = tracker.resolveReplyTarget({ to: "session-b" }, 1003);
  assert.equal(target.message.id, "ask-b");
  assert.equal(target.from.id, "b-id");
});

test("reply with non-matching to errors instead of falling back to sole pending ask", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("a-id", "session-a"), createMessage("ask-a", "From A"), 1000);

  assert.throws(() => tracker.resolveReplyTarget({ to: "session-b" }, 1001), /No pending ask from "session-b"/);
});

test("reply with non-matching to errors instead of falling back to current turn context", () => {
  const tracker = new ReplyTracker();
  const contextA = tracker.recordIncomingMessage(createSession("a-id", "session-a"), createMessage("ask-a", "From A"), 1000);
  tracker.queueTurnContext(contextA);
  tracker.beginTurn(1001);

  assert.throws(() => tracker.resolveReplyTarget({ to: "session-b" }, 1002), /No pending ask from "session-b"/);
});

test("reply with to matching current turn context returns it", () => {
  const tracker = new ReplyTracker();
  const contextA = tracker.recordIncomingMessage(createSession("a-id", "session-a"), createMessage("ask-a", "From A"), 1000);
  tracker.recordIncomingMessage(createSession("b-id", "session-b"), createMessage("ask-b", "From B"), 1001);
  tracker.queueTurnContext(contextA);
  tracker.beginTurn(1002);

  assert.equal(tracker.resolveReplyTarget({ to: "session-a" }, 1003).message.id, "ask-a");
  assert.equal(tracker.resolveReplyTarget({ to: "a-id" }, 1003).message.id, "ask-a");
});

test("reply with to errors when multiple pending asks share the same name", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("worker-1", "worker"), createMessage("ask-1", "First"), 1000);
  tracker.recordIncomingMessage(createSession("worker-2", "worker"), createMessage("ask-2", "Second"), 1001);

  assert.throws(() => tracker.resolveReplyTarget({ to: "worker" }, 1002), /Multiple pending asks from "worker"/);
  assert.equal(tracker.resolveReplyTarget({ to: "worker-2" }, 1002).message.id, "ask-2");
});

test("reply errors when no context and no pending asks", () => {
  const tracker = new ReplyTracker();

  assert.throws(() => tracker.resolveReplyTarget({}, 1000), /No active intercom context to reply to/);
});

test("reply errors when multiple pending asks and no to", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("planner-id", "planner"), createMessage("ask-1", "First"), 1000);
  tracker.recordIncomingMessage(createSession("reviewer-id", "reviewer"), createMessage("ask-2", "Second"), 1001);

  assert.throws(() => tracker.resolveReplyTarget({}, 1002), /Multiple pending asks — specify `to`/);
});

test("reply removes pending ask after successful reply", () => {
  const tracker = new ReplyTracker();
  tracker.recordIncomingMessage(createSession("planner-id", "planner"), createMessage("ask-1", "Need a decision"), 1000);

  tracker.markReplied("ask-1");

  assert.deepEqual(tracker.listPending(1001), []);
});
