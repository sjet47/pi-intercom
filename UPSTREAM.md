# Upstream Absorption

This repository is a fork of [`nicobailon/pi-intercom`](https://github.com/nicobailon/pi-intercom) with a set of local patches kept on top. `main` is the installable fork; upstream is a remote so good fixes can be cherry-picked or merged without rewriting local work.

## Remotes

```bash
git remote -v
# origin   https://github.com/sjet47/pi-intercom.git
# upstream https://github.com/nicobailon/pi-intercom.git
```

## Local Patches

The current local surface is intentionally small and should stay small:

- CLI launcher: `cli/` plus guest broker support (`broker/broker.ts`, `broker/client.ts`, `types.ts`, `broker/guest.test.ts`)
- `#alias` autocomplete and conditional input routing: `alias.ts`, `alias.test.ts`, `index.ts`
- Native Pi `/name` sync and `session_info_changed` handling: `index.ts`
- `list_all` grouping for `intercom list`: `index.ts`

Keep these changes as separate, focused commits. That makes upstream backports much easier to review and revert.

## Selective Backport

For a specific upstream fix:

```bash
git fetch upstream --tags
git log --oneline v0.6.0..upstream/main
git show <sha> --stat
git cherry-pick -x <sha>
npm run check
npm test
```

If the commit does not apply cleanly, do not force it. Create a `backport/<feature>` branch, resolve conflicts, and merge that branch into `main` after tests pass.

## Full Upstream Merge

Only use this when you intentionally want the whole upstream tree, including features we have decided not to take yet. It is not the default workflow.

```bash
git fetch upstream --tags
git merge upstream/main --no-ff
```

After the first merge, later upstream merges have a shared merge base and become easier.

## Backport Guidance

The `v0.6.2` fork already includes these upstream improvements:

- Pi runtime compatibility and `tool_result` error handling
- Broker spawn hardening (`getTsxCliPath`, current Node executable, standalone Pi fallback)
- Configurable ask timeout
- Stable intercom IDs and `/intercom-id`

For future upstream releases, prefer similar fixes that improve compatibility, correctness, or robustness without adding fixed context cost. Avoid taking delivery metadata, `cancel`/`supersede`, `list-cwd`/context presence, or the extension bus unless a real need appears; those add fixed tool schema or per-message context overhead.

## Verification

```bash
npm install
npm run check
npm test
```

CI runs the same commands on `main`.
