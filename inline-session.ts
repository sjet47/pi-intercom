import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { SessionInfo } from "./types.ts";

const SESSION_ALIAS_CHARS = "\\p{L}\\p{N}_.:-";
const SESSION_ALIAS_RE = new RegExp(
  `#([${SESSION_ALIAS_CHARS}]+)(?![${SESSION_ALIAS_CHARS}])`,
  "gu",
);
const SESSION_AUTOCOMPLETE_RE = /(#[\p{L}\p{N}_.:-]*)$/u;
const SESSION_AUTOCOMPLETE_STOP_RE = /#[\p{L}\p{N}_.:-]*[ \t]$/u;
const MAX_AUTOCOMPLETE_ITEMS = 20;

export interface ResolvedSessionAlias {
  alias: string;
  session: SessionInfo;
}

function sessionName(session: SessionInfo): string {
  return session.name?.trim() ?? "";
}

function aliasForSession(session: SessionInfo, sessions: readonly SessionInfo[]): string {
  const name = sessionName(session);
  if (
    name
    && sessions.filter((candidate) => sessionName(candidate).toLowerCase() === name.toLowerCase()).length === 1
  ) {
    return `#${name}`;
  }

  const shortId = session.id.slice(0, 8);
  if (sessions.filter((candidate) => candidate.id.startsWith(shortId)).length === 1) {
    return `#${shortId}`;
  }

  return `#${session.id}`;
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

function resolveSessionAliasWithoutTrailingSeparators(sessions: readonly SessionInfo[], alias: string): SessionInfo | null {
  let candidate = alias;
  while (/[.:-]$/u.test(candidate)) {
    candidate = candidate.slice(0, -1);
    const resolved = resolveSessionAlias(sessions, candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

export function resolveSessionAliasesInText(
  text: string,
  sessions: readonly SessionInfo[],
): ResolvedSessionAlias[] | null {
  if (!text.includes("#")) {
    return null;
  }

  const resolved = new Map<string, ResolvedSessionAlias>();
  for (const match of text.matchAll(SESSION_ALIAS_RE)) {
    const alias = `#${match[1]!}`;
    // "Ask #planner." matches SESSION_ALIAS_RE with the sentence period attached, so
    // retry without trailing separators before giving up on the mention.
    const session = resolveSessionAlias(sessions, alias) ?? resolveSessionAliasWithoutTrailingSeparators(sessions, alias);
    if (!session || resolved.has(session.id)) {
      continue;
    }
    resolved.set(session.id, { alias, session });
  }

  return resolved.size === 0 ? null : [...resolved.values()];
}

function describeSession(session: SessionInfo): string {
  const name = sessionName(session);
  return name ? `"${name}" (ID: ${session.id})` : `(ID: ${session.id})`;
}

export function transformIntercomSessionInput(
  text: string,
  sessions: readonly SessionInfo[],
): string | null {
  const aliases = resolveSessionAliasesInText(text, sessions);
  if (!aliases) {
    return null;
  }

  const targets = aliases.map(({ session }) => describeSession(session));
  const instruction = targets.length === 1
    ? `Use the intercom tool to communicate with Pi session ${targets[0]}. Prefer send for non-blocking updates and ask when a reply is required.`
    : `Use the intercom tool to communicate with Pi sessions: ${targets.join(", ")}. Prefer send for non-blocking updates and ask when a reply is required.`;

  return `${text.trimEnd()}\n\n<pi-intercom>\n${instruction}\n</pi-intercom>`;
}

export function createIntercomSessionAutocompleteProvider(
  current: AutocompleteProvider,
  getSessions: () => Promise<readonly SessionInfo[]>,
): AutocompleteProvider {
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

      const sessions = await getSessions();
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
