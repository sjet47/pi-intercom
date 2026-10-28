import test from "node:test";
import assert from "node:assert/strict";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SessionInfo } from "./types.ts";
import {
  createIntercomSessionAutocompleteProvider,
  formatIntercomMention,
  resolveSessionAlias,
  resolveSessionMention,
  sessionAutocompleteItems,
} from "./inline-session.ts";

function session(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: "session-planner-0001",
    cwd: "/repo",
    model: "test-model",
    pid: 1,
    startedAt: 1,
    lastActivity: 1,
    ...overrides,
  };
}

const sessions = [
  session({ id: "session-planner-0001", name: "planner", status: "idle" }),
  session({ id: "session-worker-0002", name: "worker" }),
  session({ id: "session-worker-0003", name: "worker" }),
  session({ id: "session-unnamed-0004" }),
];

test("sessionAutocompleteItems prefers unique names and falls back to session IDs", () => {
  const items = sessionAutocompleteItems(sessions, "");

  assert.equal(items.length, 4);
  assert.ok(items.some((item) => item.value === "#planner"));
  assert.equal(items.filter((item) => item.value === "#worker").length, 0);
  assert.ok(items.some((item) => item.value === "#session-worker-0002"));
  assert.ok(items.some((item) => item.value === "#session-worker-0003"));
  assert.ok(items.some((item) => item.value === "#session-unnamed-0004"));
  assert.match(items[0]!.description ?? "", /planner/);
});

test("every offered autocomplete value resolves back to its own session", () => {
  // A session whose name is another session's ID prefix used to make the short name
  // resolve to the wrong peer.
  const colliding = [
    session({ id: "12345678-aaaa", name: undefined }),
    session({ id: "session-other-0002", name: "12345678" }),
  ];

  for (const item of sessionAutocompleteItems(colliding, "")) {
    const resolved = resolveSessionAlias(colliding, item.value);
    assert.ok(resolved, `expected ${item.value} to resolve`);
    const owner = colliding.find((candidate) => item.description?.includes(candidate.id));
    assert.equal(resolved!.id, owner!.id, `${item.value} resolved to the wrong session`);
  }
});

test("sessionAutocompleteItems filters by session name and ID", () => {
  assert.deepEqual(sessionAutocompleteItems(sessions, "plan").map((item) => item.value), ["#planner"]);
  assert.deepEqual(sessionAutocompleteItems(sessions, "session-wo").map((item) => item.value), ["#session-worker-0002", "#session-worker-0003"]);
  assert.deepEqual(sessionAutocompleteItems(sessions, "missing"), []);
});

test("resolveSessionAlias resolves exact IDs, unique names, and unique prefixes", () => {
  assert.equal(resolveSessionAlias(sessions, "#session-planner-0001")?.id, "session-planner-0001");
  assert.equal(resolveSessionAlias(sessions, "#planner")?.id, "session-planner-0001");
  assert.equal(resolveSessionAlias(sessions, "#session-planner-000")?.id, "session-planner-0001");
  assert.equal(resolveSessionAlias(sessions, "#worker"), null);
  assert.equal(resolveSessionAlias(sessions, "#missing"), null);
  assert.equal(resolveSessionAlias(sessions, "planner"), null);
  assert.equal(resolveSessionAlias(sessions, "#"), null);
});

test("formatIntercomMention names the target and the intercom call to make", () => {
  const mention = formatIntercomMention(sessions[0]!, sessions);
  assert.match(mention, /^#planner /);
  assert.match(mention, /communicate with Pi session "planner" \(ID: session-planner-0001\)/);
  assert.match(mention, /Prefer send for non-blocking updates and ask when a reply is required/);

  const unnamed = formatIntercomMention(sessions[3]!, sessions);
  assert.match(unnamed, /^#session-unnamed-0004 /);
  assert.match(unnamed, /communicate with Pi session \(ID: session-unnamed-0004\)/);
});

test("resolveSessionMention prefers the exact argument over stripping punctuation", () => {
  const hyphenated = [
    session({ id: "session-worker-a", name: "worker-" }),
    session({ id: "session-worker-b", name: "worker" }),
  ];

  // "worker-" is a real name here, so stripping it to "worker" would target the wrong peer.
  assert.equal(resolveSessionMention(hyphenated, "worker-")?.id, "session-worker-a");
  assert.equal(resolveSessionMention(hyphenated, "#worker-")?.id, "session-worker-a");
  assert.equal(resolveSessionMention(hyphenated, "worker")?.id, "session-worker-b");

  // With no such name, sentence punctuation is tolerated as intended.
  assert.equal(resolveSessionMention(sessions, "planner.")?.id, "session-planner-0001");
  assert.equal(resolveSessionMention(sessions, "planner: now"), null);
  assert.equal(resolveSessionMention(sessions, "  "), null);
  assert.equal(resolveSessionMention(sessions, "#"), null);
  assert.equal(resolveSessionMention(sessions, "missing"), null);
});

function fakeCurrentProvider(): AutocompleteProvider {
  return {
    triggerCharacters: ["@"],
    async getSuggestions() {
      return null;
    },
    applyCompletion(lines, _cursorLine, _cursorCol, item, prefix) {
      return {
        lines: lines.map((line) => line === prefix ? item.value : line),
        cursorLine: 0,
        cursorCol: item.value.length,
      };
    },
  };
}

test("autocomplete provider suggests sessions after # and delegates otherwise", async () => {
  const current = fakeCurrentProvider();
  const provider = createIntercomSessionAutocompleteProvider(current, async () => sessions);

  const suggestions = await provider.getSuggestions(["Ask #plan"], 0, 9, { signal: new AbortController().signal, force: false });
  assert.ok(suggestions);
  assert.equal(suggestions!.prefix, "#plan");
  assert.deepEqual(suggestions!.items.map((item) => item.value), ["#planner"]);

  const delegated = await provider.getSuggestions(["Ask planner"], 0, 11, { signal: new AbortController().signal, force: false });
  assert.equal(delegated, null);
});

test("autocomplete provider triggers wherever # appears in the prompt", async () => {
  const current = fakeCurrentProvider();
  const provider = createIntercomSessionAutocompleteProvider(current, async () => sessions);

  const afterWord = await provider.getSuggestions(["Ask planner about#wor"], 0, 21, { signal: new AbortController().signal, force: false });
  assert.ok(afterWord);
  assert.equal(afterWord!.prefix, "#wor");
  assert.deepEqual(afterWord!.items.map((item) => item.value), ["#session-worker-0002", "#session-worker-0003"]);

  const midSentence = await provider.getSuggestions(["Ask #plan for a status"], 0, 9, { signal: new AbortController().signal, force: false });
  assert.ok(midSentence);
  assert.equal(midSentence!.prefix, "#plan");
  assert.deepEqual(midSentence!.items.map((item) => item.value), ["#planner"]);
});

test("autocomplete provider leaves slash commands and stops after a completed alias", async () => {
  const current = fakeCurrentProvider();
  const provider = createIntercomSessionAutocompleteProvider(current, async () => sessions);

  assert.equal(
    await provider.getSuggestions(["/skill:pi #p"], 0, 12, { signal: new AbortController().signal, force: false }),
    null,
  );
  assert.equal(
    await provider.getSuggestions(["#planner "], 0, 10, { signal: new AbortController().signal, force: false }),
    null,
  );
});

test("autocomplete provider memoizes the roster for the cache window", async () => {
  const current = fakeCurrentProvider();
  let calls = 0;
  let clock = 1_000;
  const provider = createIntercomSessionAutocompleteProvider(
    current,
    async () => {
      calls += 1;
      return sessions;
    },
    () => clock,
  );
  const options = { signal: new AbortController().signal, force: false };

  await provider.getSuggestions(["#p"], 0, 2, options);
  clock += 500;
  await provider.getSuggestions(["#p"], 0, 2, options);
  assert.equal(calls, 1);

  clock += 2_000;
  await provider.getSuggestions(["#p"], 0, 2, options);
  assert.equal(calls, 2);
});

test("autocomplete provider stays quiet when the roster is unavailable", async () => {
  const current = fakeCurrentProvider();
  const provider = createIntercomSessionAutocompleteProvider(current, async () => []);

  assert.equal(
    await provider.getSuggestions(["#p"], 0, 2, { signal: new AbortController().signal, force: false }),
    null,
  );
});
