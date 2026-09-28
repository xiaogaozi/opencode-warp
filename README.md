# OpenCode + Warp

Official [Warp](https://warp.dev) terminal integration for [OpenCode](https://opencode.ai).

## Features

### 🔔 Native Notifications

Get native Warp notifications when OpenCode:
- **Completes a task** — with a summary showing your prompt and the response
- **Needs your input** — when a permission request is pending
- **Runs a tool** — status updates as tools execute

Notifications appear in Warp's notification center and as system notifications, so you can context-switch while OpenCode works and get alerted when attention is needed.

## Installation

Requires OpenCode v2. This is a terminal (CLI) plugin and is configured in `cli.json`, not `opencode.json`.

### From npm (once a V2-compatible version is published)

Add the plugin to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["@warp-dot-dev/opencode-warp"]
}
```

### From local files

Point OpenCode at the plugin directory. OpenCode loads the `./tui` entry (`tui.ts`):

```json
{
  "plugins": ["file:///absolute/path/to/opencode-warp"]
}
```

## Requirements

- [Warp terminal](https://warp.dev) (macOS, Linux, or Windows)
- [OpenCode](https://opencode.ai) CLI v2

## How It Works

This plugin uses Warp's [pluggable notifications](https://docs.warp.dev/features/notifications) feature via OSC escape sequences. When OpenCode triggers an event, the plugin:

1. Reads event data from OpenCode's plugin API
2. Formats a concise notification payload
3. Sends an OSC 777 escape sequence to Warp, which displays a native notification

The plugin hooks into these OpenCode v2 events:
- **session.created** — confirms the plugin is active
- **session.execution.succeeded** / **session.execution.failed** — fires when OpenCode finishes responding, includes your prompt and the response (failures are reported as errors)
- **permission.asked** / **permission.replied** — fires when OpenCode needs tool approval
- **form.created** — fires when OpenCode asks a question

OpenCode v2 delivers events for every location to every running client, so the plugin scopes notifications to the location it was loaded in: a session in another directory never raises notifications in this terminal.

## Configuration

Notifications work out of the box. To customize Warp's notification behavior (sounds, system notifications, etc.), see [Warp's notification settings](https://docs.warp.dev/features/notifications).

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Run tests
bun test

# Build
bun run build
```

## Uninstall

Remove `"@warp-dot-dev/opencode-warp"` from the `plugins` array in `~/.config/opencode/cli.json`.

## Contributing

Contributions welcome! Please open an issue or PR on [GitHub](https://github.com/warpdotdev/opencode-warp).

## License

MIT License — see [LICENSE](LICENSE) for details.
