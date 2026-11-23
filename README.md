# omp-antigravity-bridge

Use Gemini models in [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi) through Google's official Antigravity CLI (`agy`), on your Antigravity subscription.

The plugin adds:

- `antigravity/gemini-*` models in `/model`, with streaming and multi-turn conversations.
- A tool bridge, so agy can call your OMP tools: extensions, MCP servers and other `Ask*` delegation tools.
- The `AskAntigravity` tool, so any model can put a one-off question to Gemini.
- An optional approval gate in front of the commands agy runs and the files it writes.

This is an OMP port of [`@estebanforge/pi-antigravity-bridge`](https://github.com/EstebanForge/pi-extensions/tree/main/packages/pi-antigravity-bridge) for [pi](https://github.com/earendil-works/pi). It tracks upstream and carries a small set of compatibility patches. [docs/OMP.md](docs/OMP.md) covers where it behaves differently from the pi version.

It uses your own Google account, so read the [terms of service](#terms-of-service) note before you install.

## Requirements

- OMP 19.1 or newer.
- The `agy` CLI, installed and signed in. The default engine needs agy 1.5.3 or newer (`agy update` upgrades an older install).

  ```bash
  curl -fsSL https://antigravity.google/cli/install.sh | bash   # Windows: irm https://antigravity.google/cli/install.ps1 | iex
  agy                                                           # once, to complete Google sign-in
  ```

  If `agy` is missing, the plugin offers to run Google's installer when you start OMP interactively. It looks for `agy` on `PATH`, or at `AGY_BIN`.

Tested with OMP 19.1.0 and agy 1.5.14.

## Install

From the [`trozzelle/omp-plugins`](https://github.com/trozzelle/omp-plugins) marketplace:

```bash
omp plugin marketplace add trozzelle/omp-plugins
omp plugin install omp-antigravity-bridge@trozzelle
```

Update with `omp plugin upgrade`. New releases reach the marketplace within six hours, and OMP re-checks the catalog once it is a day old. To check right away, run `omp plugin marketplace update trozzelle`.

Or straight from git:

```bash
omp plugin install github:trozzelle/omp-antigravity-bridge#latest   # follow releases; update with: omp plugin upgrade omp-antigravity-bridge
omp plugin install github:trozzelle/omp-antigravity-bridge#v1.13.1-omp.5   # or pin one release
```

Releases are tagged `v<upstream-version>-omp.<N>` and listed on the [Releases](https://github.com/trozzelle/omp-antigravity-bridge/releases) page. Don't install from `main`, because every upstream sync rewrites its history.

## Usage

Pick an `antigravity` model in `/model`, or pass one on the command line:

```bash
omp --model antigravity/gemini-4-hydrogen
omp --model antigravity/gemini-3-8-flash:low   # thinking level via OMP's :level suffix
omp models find antigravity                    # the models your account offers
```

Model ids come from `agy models`, without the thinking tier. OMP reads the list at startup, so restart it after `agy update`.

Each turn runs inside agy's own agent loop, in your workspace, on your subscription quota. OMP shows live token usage and zero cost. agy remembers the conversation, so each turn sends only your new message plus any OMP-side context it hasn't seen yet, such as a compaction summary or turns from another model.

### Engines

| Engine | What it is | Notes |
| --- | --- | --- |
| `acp` (default) | `agy acp`, JSON-RPC over stdio | Exact token usage. agy's own tool steps appear in the reply's thinking as trace lines, in the order they ran (`/agy steps cards` switches to separate cards). |
| `stream-json` | A persistent `agy` CLI process | The fallback. agy's read-only steps re-run as native OMP `read`/`glob`/`grep` cards. |

Both use the same `agy` install and sign-in. To switch, run `/agy engine acp|stream-json` and restart OMP. Details: [docs/ENGINES.md](docs/ENGINES.md).

### Tool bridge

While an Antigravity model is active, agy can call your OMP tools through a local MCP server inside OMP (bound to `127.0.0.1`, protected by a per-session token). The calls run in OMP's own tool loop, so they get OMP's normal cards, approvals and hooks. A call that takes longer than about 20 seconds returns a handle that agy polls, and it can run for up to 30 minutes. agy also gets an `activate_skill` tool for your skills.

`/agy bridge all|mcp|none` sets what agy can see: all of them (the default), only MCP tools and skills, or none. `/agy tools hide <name>` hides one tool for the session. If agy can see other delegation tools such as `AskClaude`, it can hand work to other models, and you pay for those calls.

### AskAntigravity

Any model can call `AskAntigravity` to ask Gemini a one-off question. Each call runs a separate `agy -p` process, by default with model `gemini-4-hydrogen` and thinking `medium`. Change the defaults with `/agy model` and `/agy thinking`.

With `background: true` the call returns at once and the answer arrives later as a message. `/agy-stop` cancels a background run. Background runs aren't available in `-p` print mode.

### Approval gate

agy runs commands and edits files with its own tools, outside OMP's. The approval gate brings them under OMP's approval mode: in any mode other than `yolo`, each agy command or file write first becomes an OMP approval prompt showing the command, or the file and its diff.

```bash
omp --approval-mode always-ask --model antigravity/gemini-4-hydrogen
```

Your `tools.approval` policies for `bash`, `write` and `edit` apply, and so do your restricted folders. `AGY_APPROVALS_MODE=allow|deny` forces a decision. agy's read-only tools are never gated.

Whether the gate is on is decided when a session starts, so start a new session after you change OMP's approval mode. On the ACP engine it is verified only with agy 1.5.12 or newer; `/agy doctor` warns about older versions. Full rules: [docs/OMP.md](docs/OMP.md#approval-gate).

Without the gate, agy runs commands without asking, like every other tool in a yolo-mode OMP session. agy's plan mode can't enforce review-only turns ([antigravity-cli#1181](https://github.com/google-antigravity/antigravity-cli/issues/1181)). For a hard stop use `/agy readonly on`, which refuses every Antigravity turn and `AskAntigravity` call.

### Web tools

`/agy web on` registers `agy_web_search` for any model. It exists for your other models, since Antigravity models can already search the web. Each call starts a search-only agy run and uses Antigravity quota.

`agy_read_url` is registered too, but agy 1.5.14 never offers its URL reader to these runs, so the tool refuses to return text it can't verify. Use OMP's own `read` for URLs.

## Configuration

`/agy` opens the settings picker. Settings are saved to `~/.omp/agent/antigravity-bridge/config.json` and apply on the next turn unless noted. Environment variables override the file.

| Setting | Default | Command | Env |
| --- | --- | --- | --- |
| `engine` (restart to apply) | `acp` | `/agy engine acp\|stream-json` | `AGY_ENGINE` |
| `bridgeTools` | `all` | `/agy bridge all\|mcp\|none` | `AGY_BRIDGE_TOOLS` |
| `askTool` (restart to apply) | `on` | `/agy ask on\|off` | `AGY_ASK_TOOL` |
| `webTools` (restart to apply) | `off` | `/agy web on\|off` | `AGY_WEB_TOOLS` |
| `digest`: send OMP-side context agy hasn't seen | `on` | `/agy digest on\|off` | `AGY_DIGEST` |
| `systemPrompt`: send your context files, skills list and appended system prompt to new agy conversations | `on` | `/agy system-prompt on\|off` | `AGY_SYSTEM_PROMPT` |
| `acp.nativeSteps`: show agy's own tool steps (ACP) as `inline` trace lines in the reply's thinking, or as `cards` that OMP draws below the finished reply | `inline` | `/agy steps inline\|cards` | `AGY_NATIVE_STEPS` |
| `readOnly`: refuse every turn | `off` | `/agy readonly on\|off` | `AGY_READONLY` |
| `skipPermissions`: auto-approve agy's own permission prompts (needed headless) | `on` | `/agy permissions on\|off` | `AGY_SKIP_PERMISSIONS` |
| `turnTimeoutMin`: cap on one turn, in minutes; pauses while OMP tools run | `0` (no cap) in the TUI, `20` headless | `/agy timeout <1-1440\|off>` | `AGY_TURN_TIMEOUT_MIN` |
| `inactivityTimeoutMin`: fail a turn after this many minutes of silence | `5` | | `AGY_INACTIVITY_TIMEOUT_MIN` |
| `defaultModel`: the `AskAntigravity` model, as an alias or an exact id | `gemini-4-hydrogen` | `/agy model flash\|pro\|gemini` | `AGY_DEFAULT_MODEL` |
| `defaultThinking`: the `AskAntigravity` thinking level | `medium` | `/agy thinking low\|medium\|high` | `AGY_DEFAULT_THINKING` |
| `approvals.gateMode`: `auto` (follow OMP's approval settings), `dedicated` (always on), `off` | `auto` | | `AGY_APPROVALS` |
| `approvals.mode`: `inherit` (OMP's approval mode decides), `ask`, `allow`, `deny` | `inherit` | | `AGY_APPROVALS_MODE` |

Other commands:

| Command | What it does |
| --- | --- |
| `/agy doctor` | Health, versions, bridge port, log directory |
| `/agy auth` | How to sign in to agy |
| `/agy clear` | Start fresh agy conversations |
| `/agy tools [hide\|show <name>\|reset]` | List the bridged tools; hide or restore one for the session |
| `/agy quota` | Your Antigravity quota |
| `/agy subagents` | Subagents agy spawned this session |
| `/agy tasks [tail <id>]` | agy's background tasks; `tail` shows the end of a task's log |
| `/agy artifacts [open <n\|name>]` | Files agy generated or received; `open` opens one |
| `/agy agent <name\|off>` | Use a custom agy agent (stream-json only) |

Less common environment variables: `AGY_BIN` (path to `agy`), `AGY_EXTRA_ARGS` (extra arguments for `AskAntigravity` runs), `AGY_DEBUG` (full debug log), `AGY_ACP_SESSION_TIMEOUT_MS` (ACP session timeout, default `20000`).

## Troubleshooting

Run `/agy doctor` first. In `-p` print mode it writes the report to stdout.

- `antigravity/*` models are missing: check that `agy models` works in a terminal, then restart OMP. If the plugin can't reach agy at startup, it shows a fallback model list and turns fail with a clear error.
- "agy CLI is not installed": install agy, or point `AGY_BIN` at it.

Logs are in `~/.omp/extensions-data/estebanforge/pi-antigravity-bridge/logs/<date>.ndjson`. Only errors are written by default; start OMP with `AGY_DEBUG=1` for the full trail. Prompts, tool arguments and tool output never go into the log, values that look like secrets are redacted, and files older than 14 days are deleted. Attach the last day or two of logs when you [open an issue](https://github.com/trozzelle/omp-antigravity-bridge/issues).

## Terms of service

Google's [Antigravity terms](https://antigravity.google/terms) prohibit using the service "in connection with products not provided by us". Google's enforcement so far has targeted tools that reuse Antigravity credentials to call its backend directly.

This plugin doesn't do that. It runs the official, unmodified `agy` binary as a subprocess. agy signs in and talks to Google itself, and the plugin only reads what agy outputs locally. It never sees your token.

The wording is still broad, and Google can suspend accounts at its discretion. Use the plugin with your own account at your own risk. This is not legal advice.

## Development

`main` is upstream's code (the `upstream` branch) plus a stack of `omp:` commits. A weekly workflow rebases the stack onto new upstream releases and opens a pull request. Promoting it tags a release, publishes the marketplace bundle and moves `latest`.

```bash
npm install
npm run typecheck && npm test && npm run test:bun
npm run smoke:omp                 # loads the extension in a real omp
bash scripts/omp/smoke-live.sh    # end-to-end checks; needs a signed-in agy, uses a little quota
```

Patch conventions and OMP host details are in [.omp/AGENTS.md](.omp/AGENTS.md), and [CHANGELOG-OMP.md](CHANGELOG-OMP.md) lists the changes this fork carries. Upstream's own README, written for pi, is on the [upstream branch](https://github.com/trozzelle/omp-antigravity-bridge/blob/upstream/README.md).

## License

MIT. Original work © EstebanForge; OMP port by trozzelle.
