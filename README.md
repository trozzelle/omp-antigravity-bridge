# omp-antigravity-bridge

Gemini models in [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi), powered by Google's official Antigravity CLI (`agy`) on your Antigravity subscription. It adds:

- an `antigravity` provider: `antigravity/gemini-*` models in `/model`, streaming, multi-turn;
- a tool bridge, so agy can call your OMP tools (extensions, MCP servers, other `Ask*` delegations);
- the `AskAntigravity` tool, so any model can delegate a one-shot question to Gemini;
- an optional approval gate in front of agy's own commands and file writes.

This is an OMP port of [`@estebanforge/pi-antigravity-bridge`](https://github.com/EstebanForge/pi-extensions/tree/main/packages/pi-antigravity-bridge) for [pi](https://github.com/earendil-works/pi). It tracks upstream and carries a small set of compatibility patches. Where OMP behaves differently from pi, see [docs/OMP.md](docs/OMP.md).

## Requirements

- OMP 19.1 or newer.
- The `agy` CLI, installed and signed in:

  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash   # Windows: irm https://antigravity.google/cli/install.ps1 | iex
  agy                                                           # once, to complete Google sign-in
  ```

  If `agy` is missing, the bridge offers to run Google's installer on first interactive start. It looks for `agy` on `PATH`, or at `AGY_BIN`.

Tested with OMP 19.1.0 and agy 1.5.14.

## Install

From the [`trozzelle/omp-plugins`](https://github.com/trozzelle/omp-plugins) marketplace:

```bash
omp plugin marketplace add trozzelle/omp-plugins
omp plugin install omp-antigravity-bridge@trozzelle
```

Update with `omp plugin upgrade`. OMP re-checks the catalog once it is a day old; `omp plugin marketplace update trozzelle` checks right away. New releases reach the marketplace within six hours. Each release also publishes its catalog as a release asset, which works as a marketplace source on its own (`omp plugin marketplace add https://github.com/trozzelle/omp-antigravity-bridge/releases/latest/download/marketplace.json`); both are named `trozzelle`, so add only one.

Or straight from git:

```bash
omp plugin install github:trozzelle/omp-antigravity-bridge#latest   # follow releases; update with: omp plugin upgrade omp-antigravity-bridge
omp plugin install github:trozzelle/omp-antigravity-bridge#v1.13.1-omp.5   # or pin one release
```

Releases are tagged `v<upstream-version>-omp.<N>` and listed on the [Releases](https://github.com/trozzelle/omp-antigravity-bridge/releases) page. Don't install from `main`; its history is rewritten on every upstream sync.

## Usage

Pick a model in `/model` (look for `antigravity`), or pass it on the command line:

```bash
omp --model antigravity/gemini-4-hydrogen
omp --model antigravity/gemini-3-8-flash:low   # thinking level via OMP's :level suffix
omp models find antigravity                    # the models your account offers
```

Model ids come from `agy models` without the thinking tier. The list is read when OMP starts; restart OMP after `agy update` to refresh it.

Turns run inside agy's own agent loop, in your workspace, on your subscription quota. OMP shows live token usage and zero cost. agy remembers the conversation, so each turn sends only your new message plus any OMP-side context it hasn't seen yet (for example a compaction summary or turns from another model).

### Engines

| Engine | What it is | Notes |
| --- | --- | --- |
| `acp` (default) | `agy acp`, JSON-RPC over stdio | Exact token usage; agy's own tool steps appear as cards in the transcript |
| `stream-json` | A persistent `agy` CLI process | Fallback; agy's read-only steps re-run as native OMP `read`/`glob`/`grep` cards |

Both use the same `agy` install and sign-in. Switch with `/agy engine acp|stream-json` and restart OMP. Details: [docs/ENGINES.md](docs/ENGINES.md).

### Tool bridge

While an Antigravity model is active, agy reaches your OMP tools through a local MCP server inside OMP (bound to `127.0.0.1`, protected by a per-session token). The calls run in OMP's own tool loop, so they get OMP's normal cards, approvals and hooks. Calls that take longer than about 20 seconds come back as a handle that agy polls; they can run for up to 30 minutes. agy also gets an `activate_skill` tool for your skills.

`/agy bridge all|mcp|none` controls what is exposed (default `all`). `/agy tools hide <name>` hides individual tools for the session. Exposing other delegation tools (`AskClaude`, …) lets agy fan out to other models and costs accordingly.

### AskAntigravity

Any model can call `AskAntigravity` to hand Gemini a one-shot question. It runs a separate `agy -p` process (default model `gemini-4-hydrogen`, thinking `medium`; change with `/agy model` and `/agy thinking`). With `background: true` the call returns at once and the answer arrives later as a message; `/agy-stop` cancels a background run. Background runs aren't available in `-p` print mode.

### Approval gate

agy runs commands and edits files with its own tools, outside OMP's tools. Run OMP in any approval mode other than yolo and the gate turns on: each agy command or file write first becomes an OMP approval prompt showing the command, or the file and its diff. Your `tools.approval` policies for `bash`/`write`/`edit` and your restricted folders apply. `AGY_APPROVALS_MODE=allow|deny` forces a decision. Read-only agy tools are never gated.

```bash
omp --approval-mode always-ask --model antigravity/gemini-4-hydrogen
```

Without the gate, agy runs commands without asking, like every other tool in a yolo-mode OMP session. agy's plan mode can't enforce review-only turns ([antigravity-cli#1181](https://github.com/google-antigravity/antigravity-cli/issues/1181)). For a hard stop use `/agy readonly on`: every Antigravity turn and `AskAntigravity` call is refused.

### Web tools

`/agy web on` registers `agy_web_search` for any model. Each call spawns a search-only agy run and uses Antigravity quota. `agy_read_url` is registered too, but agy 1.5.14 never offers its URL-read tool to these runs, so it refuses rather than return unverified text. Use OMP's own `read` for URLs.

## Configuration

`/agy` opens the settings picker. Settings are saved to `~/.omp/agent/antigravity-bridge/config.json` and apply on the next turn; environment variables override the file.

| Command | Setting | Default | Env |
| --- | --- | --- | --- |
| `/agy engine acp\|stream-json` | `engine` (restart to apply) | `acp` | `AGY_ENGINE` |
| `/agy bridge all\|mcp\|none` | `bridgeTools` | `all` | `AGY_BRIDGE_TOOLS` |
| `/agy ask on\|off` | `askTool` | `on` | `AGY_ASK_TOOL` |
| `/agy web on\|off` | `webTools` (applies after restarting OMP) | `off` | `AGY_WEB_TOOLS` |
| `/agy digest on\|off` | `digest`: send OMP-side context agy hasn't seen | `on` | `AGY_DIGEST` |
| `/agy system-prompt on\|off` | `systemPrompt`: send your context files, skills list and append prompt to new agy conversations | `on` | `AGY_SYSTEM_PROMPT` |
| `/agy readonly on\|off` | `readOnly`: refuse every turn | `off` | `AGY_READONLY` |
| `/agy permissions on\|off` | `skipPermissions`: auto-approve agy's own permission prompts (needed headless) | `on` | `AGY_SKIP_PERMISSIONS` |
| `/agy timeout <1-1440\|off>` | `turnTimeoutMin`: cap on one turn; pauses while tools run | `0` in the TUI, `20` headless | `AGY_TURN_TIMEOUT_MIN` |
| | `inactivityTimeoutMin`: fail a turn after this much silence | `5` | `AGY_INACTIVITY_TIMEOUT_MIN` |
| `/agy model flash\|pro\|gemini` | `AskAntigravity` default model (an alias or an exact id) | `gemini-4-hydrogen` | `AGY_DEFAULT_MODEL` |
| `/agy thinking low\|medium\|high` | `AskAntigravity` default thinking | `medium` | `AGY_DEFAULT_THINKING` |
| | `approvals.gateMode`: `auto`, `dedicated`, `off` | `auto` | `AGY_APPROVALS` |
| | `approvals.mode`: `inherit`, `ask`, `allow`, `deny` | `inherit` | `AGY_APPROVALS_MODE` |

Other commands: `/agy doctor` (health, versions, bridge port, log directory), `/agy auth`, `/agy clear` (start fresh agy conversations), `/agy tools [hide|show <name>|reset]`, `/agy quota`, `/agy subagents`, `/agy tasks [tail <id>]`, `/agy artifacts [open <n>]`, `/agy agent <name|off>` (stream-json only).

Less common environment variables: `AGY_BIN` (path to `agy`), `AGY_EXTRA_ARGS` (extra arguments for every agy invocation), `AGY_DEBUG` (full debug log), `AGY_ACP_SESSION_TIMEOUT_MS`.

## Troubleshooting

- Run `/agy doctor` first. In `-p` print mode it writes the report to stdout.
- Logs: `~/.omp/extensions-data/estebanforge/pi-antigravity-bridge/logs/<date>.ndjson`. Only errors are written by default; start OMP with `AGY_DEBUG=1` for the full trail. Prompts, tool arguments and tool output never go into the log, and secret-shaped values are redacted. Files older than 14 days are deleted.
- `antigravity/*` models missing: check `agy models` works in a terminal, then restart OMP. If agy can't be reached at startup, a fallback model list is shown, and turns fail with a clear error.
- "agy CLI is not installed": install agy, or point `AGY_BIN` at it.

## Terms of service

Google's [Antigravity terms](https://antigravity.google/terms) prohibit using the service "in connection with products not provided by us"; Google's enforcement so far targeted tools that reuse Antigravity credentials against Google's backend. This plugin doesn't do that. It runs the official, unmodified `agy` binary as a subprocess, which signs in and talks to Google itself; the plugin never sees your token and only reads agy's local output. The wording is still broad and Google can suspend accounts at its discretion. Use it with your own account at your own risk. This is not legal advice.

## Development

`main` is upstream's code (branch `upstream`) plus a stack of `omp:` commits. A weekly workflow rebases the stack onto new upstream releases and opens a pull request; promoting it tags a release, publishes the marketplace bundle and moves `latest`. Patch conventions and host details: [.omp/AGENTS.md](.omp/AGENTS.md). Changes this fork carries: [CHANGELOG-OMP.md](CHANGELOG-OMP.md). Upstream's own README, written for pi: [upstream branch](https://github.com/trozzelle/omp-antigravity-bridge/blob/upstream/README.md).

```bash
npm install
npm run typecheck && npm test && npm run test:bun
npm run smoke:omp                 # loads the extension in a real omp
bash scripts/omp/smoke-live.sh    # end-to-end checks; needs a signed-in agy, uses a little quota
```

## License

MIT. Original work © EstebanForge; OMP port by trozzelle.
