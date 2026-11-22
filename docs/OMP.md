# Using the bridge with OMP

This fork runs the Antigravity bridge inside [OMP (oh-my-pi)](https://github.com/can1357/oh-my-pi). Features match upstream; the differences below come from how OMP differs from pi.

Tested with OMP 19.1.0 and agy 1.5.14.

## Install

Requires the `agy` CLI, installed and signed in (run `agy` once to complete Google sign-in).

Install through the [`trozzelle/omp-plugins`](https://github.com/trozzelle/omp-plugins) marketplace, which a bare `omp plugin upgrade` keeps current:

```bash
omp plugin marketplace add trozzelle/omp-plugins
omp plugin install omp-antigravity-bridge@trozzelle
```

To move to the next release later, run `omp plugin upgrade`. OMP refreshes a marketplace catalog on its own when the cached copy is older than 24 hours; `omp plugin marketplace update trozzelle` checks for a new release immediately.

Each release publishes its own `marketplace.json` pointing at a prebuilt, self-contained bundle (marketplace installs don't run `npm install`, so the bundle carries every dependency itself); the marketplace repository picks it up within six hours. The release asset also works directly as a marketplace source: `https://github.com/trozzelle/omp-antigravity-bridge/releases/latest/download/marketplace.json`. Both are named `trozzelle`, so add only one; to switch, `omp plugin marketplace remove trozzelle` and add the other (the installed plugin stays installed).

Alternatively, install straight from git through the moving `latest` tag:

```bash
omp plugin install github:trozzelle/omp-antigravity-bridge#latest
```

`latest` always points at the newest release. Upgrade this kind of install by name, `omp plugin upgrade omp-antigravity-bridge`, which re-resolves `latest`; a bare `omp plugin upgrade` only covers marketplace plugins.

To stay on one release, pin its tag instead. Releases are tagged `v<upstream-version>-omp.<N>`; for example, `#v1.13.1-omp.1` is the first OMP release built on upstream 1.13.1. The list is on the repository's [Releases](https://github.com/trozzelle/omp-antigravity-bridge/releases) page.

Don't install from `main`: it is rebuilt on top of each new upstream release, so its history is rewritten.

Then pick a model:

```
/model antigravity/gemini-4-hydrogen
```

Model ids leave out the thinking tier (`antigravity/gemini-3-8-flash`, not `antigravity/gemini-3-8-flash-low`); choose the tier with OMP's thinking level.

Settings, logs and session bindings live under OMP's directories: `~/.omp/agent/antigravity-bridge/` and `~/.omp/extensions-data/estebanforge/pi-antigravity-bridge/logs/`.

## Differences from upstream

### Approval gate

Upstream gates agy's native commands and file writes by temporarily replacing pi's `bash`, `write` and `edit` tools. Under OMP the bridge leaves OMP's own tools alone and registers one extra tool, `antigravity_native_approval`, that OMP's approval system decides on:

- agy's `run_command` is treated as a command (OMP's `exec` tier); file creation and edits as writes.
- OMP's prompt shows what agy wants to do: the command, or the file and a short diff.
- `always-ask-cached` grants and `tools.restrictedFolders` apply to agy's writes.
- Your `tools.approval` policies for `bash`, `write` and `edit` apply to the matching agy action (`run_command`, file creation, edits) under `approvals.mode: inherit`, unless you set a policy for `antigravity_native_approval` itself, which wins.
- agy's own permission requests follow the gate. While the gate is on, `skipPermissions` no longer auto-allows them: `approvals.mode: allow` allows, `deny` denies, and `ask` opens the ACP permission dialog (headless runs deny). `inherit` allows them only when OMP itself would not gate (yolo mode, no restrictive policy, no restricted folder) and otherwise opens the dialog. When agy asks for an action OMP already prompted for, you may be asked twice.

`approvals.mode` (or `AGY_APPROVALS_MODE`) accepts `inherit`, the default under OMP: OMP's approval mode decides. `allow` and `deny` still force a decision (they do not consult your `tools.approval` policies), except that a file in a `tools.restrictedFolders` folder still prompts under `allow`, because OMP's restricted-folder check overrides a tool's `allow`. With `approvals.gateMode: auto` (the default) the gate turns on when OMP's approval mode is anything other than `yolo`, when `tools.restrictedFolders` is set, or when `tools.approval` sets `bash`, `write`, `edit` or `antigravity_native_approval` to `prompt` or `deny`.

Whether the gate is on is decided when a session starts; after changing OMP's approval mode, start a new session for the gate to follow it.

OMP's plan mode does not see agy's writes, because they never pass through OMP's tools. Use `readOnly` (`/agy readonly on`) when agy must not write.

### System prompt

With `systemPrompt: on`, agy receives the parts of OMP's system prompt it can use:

- your context files (AGENTS.md and similar) and the list of directories with their own rules;
- the additional workspace directories, when you added any;
- the skills list, pointed at the bridge's `activate_skill` tool (left out when the bridge offers no skills);
- the always-apply rules;
- the text you appended with `--append-system-prompt` or `APPEND_SYSTEM.md`.

Everything else in OMP's default prompt is left out because agy cannot follow it: the tool and harness instructions, the domain-rule list, the workstation summary, the workspace tree and the eval helper notes. A subagent's own prompt (its role, context, working-tree limits and completion instructions) is sent to agy as is. If you replaced OMP's system prompt with your own (a custom prompt or a `SYSTEM.md` template), it is sent to agy as is.

OMP sends your latest message, plus any notices it attached after it, as the prompt. With `digest: on` (the default), the earlier conversation reaches agy as a context summary, which does not repeat that message. After `/compact` or a branch return, OMP's summary goes into the context summary rather than the prompt.

### Skills

The `activate_skill` catalog is the session's real skill list, including skills from installed plugins, and leaves out skills OMP hides from the model. It follows the skills list in OMP's system prompt: when OMP lists no skills there (every skill hidden, or no active tool can read `skill://`), the bridge offers none. If you replaced OMP's system prompt with your own, the bridge cannot tell and offers every skill.

### Native tool cards

agy's native tool steps (ACP engine) and bridge poll runs show as cards, kept out of the model's context and restored on resume. OMP draws these cards after the reply finishes rather than live above it.

### Model-switch notice

The notice about switching into an Antigravity model mid-session appears when you send the next prompt, not at the moment you pick the model.

### Subagents

Subagents can use Antigravity models and the bridged tools. All sessions in one OMP process share one bridge; each session keeps its own agy process and tool catalog, and the bridge shuts down when the last session ends. Model calls OMP does not tie to a known session (advisors, subagents running on worker threads) use the main session's agy process and tools: they wait for its open turn, and on the stream-json engine each switch between their conversation and the main session's restarts that agy process.

On the stream-json engine each session's agy reaches the bridge through its own isolated home. If agy refuses `--gemini_dir` or `AGY_AGENTS_ROOT` is set, every agy reads the one global `pi-bridge-<pid>` entry instead, and the bridge cannot tell which session a call comes from: while two sessions are mid-turn at once it refuses their bridged tool calls and lists no tools.

### One-shot calls

Compaction, title and branch-summary calls and `/btw` side turns run in a throwaway agy conversation. On the stream-json engine (with its isolated home) each also gets its own agy process, without the bridged tools, so it neither waits for the session's turn nor restarts the session's agy; with the approval gate on, an action that agy wants approved is put to the session that has a turn open, and denied when no session or several sessions do. On ACP they use the session's agy process and wait until its open turn ends, parked tool calls included.

### Web tools

`agy_web_search` and `agy_read_url` (off by default; `/agy web on`) accept an answer only when agy actually ran that tool's own native step: `search_web` for a search, `read_url_content` for a URL read. agy 1.5.14 never offers `read_url_content` to a headless run, so on that version `agy_read_url` fails with "refusing it as unverified" instead of returning text agy found through search. `agy_web_search` works.

## Checking an install

```bash
/agy doctor
```

In the TUI it prints bridge state, versions and the log directory. In print mode (`omp -p`) it writes the same report to stdout.

## Contributing

This repository keeps upstream's code on the `upstream` branch and adds OMP patches on `main`. A weekly workflow rebases the patches onto new upstream releases and opens a pull request; a maintainer promotes a green sync to `main` and tags it. Patch conventions and the verification commands are in `.omp/AGENTS.md`. Run before sending a change:

```bash
npm install
npm run typecheck
npm test
npm run test:bun
npm run smoke:omp
```

`scripts/omp/smoke-live.sh` runs the end-to-end checks against a signed-in agy. It uses small prompts, but they count against your Antigravity quota.
