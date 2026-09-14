import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SessionInfo } from "./types.ts";

const SESSION_AUTOCOMPLETE_RE = /(#[\p{L}\p{N}_.:-]*)$/u;
const SESSION_AUTOCOMPLETE_STOP_RE = /#[\p{L}\p{N}_.:-]*[ \t]$/u;
const MAX_AUTOCOMPLETE_ITEMS = 20;
const SESSION_LIST_CACHE_TTL_MS = 2000;

export interface ResolvedSessionAlias {
  alias: string;
  session: SessionInfo;
}

function sessionName(session: SessionInfo): string {
  return session.name?.trim() ?? "";
}

export function resolveSessionAlias(
  sessions: readonly SessionInfo[],
  alias: string,
): SessionInfo | null {
  if (!alias.startsWith("#")) {
    return null;
  }
  const key = alias.slice(1);
  if (!key) {
    return null;
  }

  const exactId = sessions.find((session) => session.id === key);
  if (exactId) {
    return exactId;
  }

  const lowerKey = key.toLowerCase();
  const byName = sessions.filter(
    (session) => sessionName(session).toLowerCase() === lowerKey,
  );
  if (byName.length === 1) {
    return byName[0]!;
  }

  const byIdPrefix = sessions.filter((session) => session.id.startsWith(key));
  return byIdPrefix.length === 1 ? byIdPrefix[0]! : null;
}

/**
 * A mention that a human can read, and that `resolveSessionAlias` is guaranteed to
 * resolve back to this exact session. A session name that is also another session's
 * ID prefix would otherwise resolve to that other session, so every candidate is
 * round-tripped through the resolver before it is offered.
 */
function aliasForSession(session: SessionInfo, sessions: readonly SessionInfo[]): string {
  const candidates: string[] = [];
  const name = sessionName(session);
  if (name && sessions.filter((candidate) => sessionName(candidate).toLowerCase() === name.toLowerCase()).length === 1) {
    candidates.push(`#${name}`);
  }
  const shortId = session.id.slice(0, 8);
  if (sessions.filter((candidate) => candidate.id.startsWith(shortId)).length === 1) {
    candidates.push(`#${shortId}`);
  }
  candidates.push(`#${session.id}`);

  return candidates.find((candidate) => resolveSessionAlias(sessions, candidate)?.id === session.id)
    ?? `#${session.id}`;
}

export function sessionAutocompleteItems(
  sessions: readonly SessionInfo[],
  query: string,
): AutocompleteItem[] {
  const lowerQuery = query.toLowerCase();
  const matches = sessions.filter((session) => {
    const name = sessionName(session).toLowerCase();
    const id = session.id.toLowerCase();
    return name.startsWith(lowerQuery) || id.startsWith(lowerQuery);
  });

  return matches
    .slice(0, MAX_AUTOCOMPLETE_ITEMS)
    .map((session) => {
      const alias = aliasForSession(session, sessions);
      const name = sessionName(session);
      const description = `${name ? `${name} · ` : ""}${session.id} · ${session.cwd} [${session.model}${session.status ? `, ${session.status}` : ""}]`;
      return {
        value: alias,
        label: alias,
        description,
      };
    });
}

/**
 * The snippet a user inserts to hand one peer session to the model by name. This
 * mirrors `formatIntercomContactSnippet`, which does the same for the local session.
 */
export function formatIntercomMentionInstruction(session: SessionInfo): string {
  const name = sessionName(session);
  const target = name ? `"${name}" (ID: ${session.id})` : `(ID: ${session.id})`;
  return `Use the intercom tool to communicate with Pi session ${target}. Prefer send for non-blocking updates and ask when a reply is required.`;
}

/**
 * The complete snippet `/intercom-mention` inserts: a mention a human can read, plus
 * the instruction that tells the model which session it refers to.
 */
export function formatIntercomMention(session: SessionInfo, sessions: readonly SessionInfo[]): string {
  return `${aliasForSession(session, sessions)} ${formatIntercomMentionInstruction(session)}`;
}

export function createIntercomSessionAutocompleteProvider(
  current: AutocompleteProvider,
  getSessions: () => Promise<readonly SessionInfo[]>,
  now: () => number = Date.now,
): AutocompleteProvider {
  // Suggestions are best-effort and fire while the user types, so the roster is
  // memoized here instead of adding roster state to the session runtime.
  let cachedSessions: readonly SessionInfo[] | null = null;
  let cachedAt = 0;
  const loadSessions = async (): Promise<readonly SessionInfo[]> => {
    const timestamp = now();
    if (cachedSessions && timestamp - cachedAt < SESSION_LIST_CACHE_TTL_MS) {
      return cachedSessions;
    }
    const sessions = await getSessions();
    cachedSessions = sessions;
    cachedAt = timestamp;
    return sessions;
  };

  return {
    triggerCharacters: ["#"],

    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
      if ((lines[0] ?? "").trimStart().startsWith("/")) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      if (!options.force && SESSION_AUTOCOMPLETE_STOP_RE.test(beforeCursor)) {
        return null;
      }

      const prefix = beforeCursor.match(SESSION_AUTOCOMPLETE_RE)?.[1];
      if (!prefix) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const sessions = await loadSessions();
      const items = sessionAutocompleteItems(sessions, prefix.slice(1));
      if (items.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return { prefix, items };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}
