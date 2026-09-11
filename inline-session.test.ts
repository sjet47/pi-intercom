import test from "node:test";
import assert from "node:assert/strict";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SessionInfo } from "./types.ts";
import {
  createIntercomSessionAutocompleteProvider,
  resolveSessionAlias,
  resolveSessionAliasesInText,
  sessionAutocompleteItems,
  transformIntercomSessionInput,
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

test("sessionAutocompleteItems prefers unique names and falls back to short IDs", () => {
  const items = sessionAutocompleteItems(sessions, "");

  assert.equal(items.length, 4);
  assert.ok(items.some((item) => item.value === "#planner"));
  assert.equal(items.filter((item) => item.value === "#worker").length, 0);
  assert.ok(items.some((item) => item.value === "#session-worker-0002"));
  assert.ok(items.some((item) => item.value === "#session-worker-0003"));
  assert.ok(items.some((item) => item.value === "#session-unnamed-0004"));
  assert.match(items[0]!.description ?? "", /planner/);
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
});

test("resolveSessionAliasesInText ignores unknown aliases and de-duplicates repeated sessions", () => {
  const aliases = resolveSessionAliasesInText("Tell #planner and then #planner again.", sessions);
  assert.ok(aliases);
  assert.equal(aliases!.length, 1);
  assert.equal(aliases![0]!.session.id, "session-planner-0001");

  assert.equal(resolveSessionAliasesInText("Use #unknown and #worker.", sessions), null);
  assert.equal(resolveSessionAliasesInText("# Heading", sessions), null);
});

test("transformIntercomSessionInput appends an intercom instruction for known sessions", () => {
  const transformed = transformIntercomSessionInput("Ask #planner for a status update.", sessions);
  assert.ok(transformed);
  assert.match(transformed!, /Ask #planner for a status update\./);
  assert.match(transformed!, /Use the intercom tool to communicate with Pi session "planner" \(ID: session-planner-0001\)/);
  assert.match(transformed!, /<pi-intercom>/);
  assert.match(transformed!, /<\/pi-intercom>/);
  assert.match(transformed!, /Prefer send for non-blocking updates and ask when a reply is required/);
});

test("transformIntercomSessionInput supports multiple known sessions", () => {
  const transformed = transformIntercomSessionInput("Tell #planner and #session-worker-0003 to compare notes.", sessions);
  assert.ok(transformed);
  assert.match(transformed!, /"planner"/);
  assert.match(transformed!, /"worker"/);
  assert.match(transformed!, /communicate with Pi sessions:/);
});

test("transformIntercomSessionInput leaves unknown input unchanged", () => {
  assert.equal(transformIntercomSessionInput("Use #missing.", sessions), null);
  assert.equal(transformIntercomSessionInput("No mention here.", sessions), null);
  assert.equal(transformIntercomSessionInput("# Heading", sessions), null);
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
