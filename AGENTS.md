# AGENTS.md

## Project
OpenCode plugin that sends native Warp terminal notifications via OSC 777 escape sequences. Single-package TypeScript ESM, published to npm as `@warp-dot-dev/opencode-warp`. This checkout is a long-lived personal fork of `warpdotdev/opencode-warp`.

## Commands (use Bun, not npm/node)
- Install: `bun install`
- Typecheck: `bun run typecheck` (`tsc --noEmit`)
- Test (all): `bun test`
- Test (one file): `bun test tests/payload.test.ts`
- Build: `bun run build` (`tsc` → `dist/`)
- Pre-push verification: `bun run typecheck && bun test` — exactly what CI runs. There is no lint step.

## Toolchain quirks
- Tests must run under `bun test`: the suite mixes `node:test` (`tests/index.test.ts`, `tests/payload.test.ts`) and `bun:test` (`tests/notify.test.ts`, uses `mock.module`). `node --test` can't run the whole suite.
- Build/typecheck use `tsc`. There's no `bun.lockb`; the lockfile is npm's `package-lock.json` (still install with bun).
- No linter/formatter configured. Match existing style by hand: no statement-ending semicolons, 2-space indent.

## Architecture
- `tui.ts` — local CLI plugin directory entry (re-exports `src/tui.ts`). OpenCode v2 loads `<dir>/tui.ts` (or the package `./tui` export) in the terminal client.
- `src/tui.ts` — CLI plugin entrypoint, default-exports `Plugin.define({ id: "opencode-warp", setup })` from `@opencode/plugin/tui`; subscribes via `context.data.on(...)` and unsubscribes on cleanup.
- Why CLI and not a server plugin: notifications write OSC 777 to `/dev/tty`, and the V2 background server is detached with no controlling terminal. Only the TUI process can reach Warp.
- `src/payload.ts` — `buildPayload()` + protocol negotiation (plugin max protocol = 1).
- `src/notify.ts` — `warpNotify()` writes the OSC 777 sequence to `/dev/tty` (`writeFileSync`, 3 retries, body capped at 4096); returns `{ success, error }`.
- `src/utils.ts` — `truncate`, `extractTextFromParts`.
- `src/location.ts` — `classifyEvent()` / `resolveEventDirectory()` / `normalizeDirectory()`; scopes global V2 events to this plugin instance's location.
- Gate: the plugin no-ops unless `WARP_CLI_AGENT_PROTOCOL_VERSION` is set (Warp sets it for the terminal process).

## Gotchas
- V1 plugin code does not run on V2 and vice versa; `@opencode/plugin` (v2) replaces `@opencode-ai/plugin` + `@opencode-ai/sdk`.
- Configure the plugin in `~/.config/opencode/cli.json` under `plugins`, not in `opencode.json`. It is a CLI-only package (exports only `./tui`).
- The V2 CLI event stream delivers durable events to `context.data.on` for **every location** (`ctx.location` is the plugin instance's location, not the location of every session it can observe). Every handler must scope events through `classifyEventWithFallback()` in `src/location.ts`; without it every running TUI notifies for every session, and Warp — which tracks one CLI agent session per terminal view — shows identical notification titles everywhere and duplicates each event once per TUI. Execution lifecycle events (`session.execution.*`, `session.usage.updated`) carry no `location`, so the helper resolves those via the client-local session store first, then `client.session.get()`; only when every lookup fails is an event assumed local (logged under `OPENCODE_WARP_DEBUG`).
- Ephemeral events such as `session.idle` and `session.status` are NOT delivered to CLI plugins; completion notifications therefore use `session.execution.succeeded` / `session.execution.failed`.
- Events handled by `src/tui.ts`: `session.created`, `session.execution.succeeded`, `session.execution.failed`, `permission.asked`, `permission.replied`, `form.created`. V1's `permission.updated` and `question.asked` no longer exist in the V2 event stream. Success sends `stop`, failure sends `stop_failure` with `error_type`.
- The plugin never writes to console by default (CLI plugins run inside the TUI). Set `OPENCODE_WARP_DEBUG=1` to route debug logs to stderr.
- `package.json` metadata (homepage/repo/bugs/author) still points at upstream `warpdotdev` — expected in the fork.
- Not source, don't edit: `dist/` (build output, gitignored) and `.opencode/` (local dev sandbox, untracked).

## Fork workflow
- Remotes: `origin` = fork (`xiaogaozi/opencode-warp`), `upstream` = `warpdotdev/opencode-warp`.
- `main` mirrors `upstream/main` (keep clean); `gcj/main` is the personal integration mainline; personal branches use the `gcj/` prefix.
- ALWAYS base on `gcj/main`: create new branches off `gcj/main`, and open every PR against `gcj/main`. Never branch from or target the upstream `main` (or the fork's mirror `main`).
- Sync upstream: `git fetch upstream` → fast-forward `main` from `upstream/main` → merge `main` into `gcj/main`.
