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
- `src/index.ts` — entrypoint, exports `WarpPlugin`; registers a single `event` handler.
- `src/payload.ts` — `buildPayload()` + protocol negotiation (plugin max protocol = 1).
- `src/notify.ts` — `warpNotify()` writes the OSC 777 sequence to `/dev/tty` (`writeFileSync`, 3 retries, body capped at 4096); returns `{ success, error }`.
- `src/utils.ts` — `truncate`, `extractTextFromParts`.
- Gate: the plugin no-ops unless `WARP_CLI_AGENT_PROTOCOL_VERSION` is set (Warp sets it); notifications only emit when running inside Warp.

## Gotchas
- `README.md`'s event list is stale (it mentions `message.updated` / `tool.execute.after`). `src/index.ts` actually handles `session.created`, `session.idle`, `permission.updated`, `permission.replied`, `permission.asked`, `question.asked`. Trust the code.
- `package.json` metadata (homepage/repo/bugs/author) still points at upstream `warpdotdev` — expected in the fork.
- Not source, don't edit: `dist/` (build output, gitignored) and `.opencode/` (local dev sandbox, untracked).

## Fork workflow
- Remotes: `origin` = fork (`xiaogaozi/opencode-warp`), `upstream` = `warpdotdev/opencode-warp`.
- `main` mirrors `upstream/main` (keep clean); `gcj/main` is the personal integration mainline; personal branches use the `gcj/` prefix.
- ALWAYS base on `gcj/main`: create new branches off `gcj/main`, and open every PR against `gcj/main`. Never branch from or target the upstream `main` (or the fork's mirror `main`).
- Sync upstream: `git fetch upstream` → fast-forward `main` from `upstream/main` → merge `main` into `gcj/main`.
