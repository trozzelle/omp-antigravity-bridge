# Changelog (OMP patch stack)

Changes this fork carries on top of upstream `@estebanforge/pi-antigravity-bridge`. Entries marked `[upstreamable]` are host-independent fixes offered upstream; they leave this list once upstream ships them.

## Unreleased

- omp: add fork guidance and ignore rules (repo)
- omp: package as omp-antigravity-bridge with a standalone test harness (packaging)
- omp: hoist ACP activity helpers out of the switch and sort ACP cleanup listings for Bun (runtime) [upstreamable]
- omp: detect the OMP host and load without generateDiffString or registerEntryRenderer (load)
- omp: upstream sync automation, CI workflows, load smoke and live checklist (sync)
- omp: read OMP's system prompt, tools and developer-role messages (context)
- omp: flush session bindings before shutdown (sessions) [upstreamable]
- omp: keep OMP one-shot calls and side turns off the session's conversation and recognise OMP compaction summaries (compaction)
- omp: share one bridge runtime across subagent sessions (runtime)
- omp: send real tool schemas to agy, match OMP MCP tools in `mcp` mode, never bridge OMP harness tools (catalog)
- omp: re-execute agy `read_file` steps as native reads (re-exec) [upstreamable]
- omp: re-execute agy read steps on OMP `read` selectors, `list_dir` on `read`, `find_by_name` on `glob`, without the pi-only reasoning argument (re-exec)
- omp: draw native-event and poll-run cards as display-only messages (cards)
- omp: dedicated approval tool deferring to the host approval mode; approvals.mode inherit; gate auto and ACP permission policy follow host approval settings (approval)
- omp: build the activate_skill catalog from the session's skill commands (skills) [upstreamable]
- omp: show the first-run engine picker and the model-switch handoff toast, skip patch-cleanup (ui-events)
- omp: claim AskAntigravity at import time so pi-ask-antigravity defers in any load order under OMP's batch loader (interop)
- omp: print /agy doctor to stdout in headless print mode (doctor) [upstreamable]
- omp: document installing and using the bridge with OMP (docs)
- omp: keep the user's message and OMP summary messages out of the digest (context)
- omp: fail closed on agy's own permission requests while the approval gate is on: skipPermissions no longer auto-allows them, approvals.mode allow/deny decide, ask/inherit park on the permission dialog; permission log events carry the tool identity (approval) [upstreamable]
- omp: point agy at activate_skill only once the bridge serves it (context)
- omp: wire the OMP approval gate and session teardown beside upstream's blocks instead of inside them (runtime)
- omp: draw command output in expanded native-event cards without carriage returns or control bytes (cards) [upstreamable]
- omp: finish a call whose signal is already aborted as aborted and log it at debug instead of a driver-start-failed error (provider) [upstreamable]
- omp: count each bridge_poll_result poll once in the poll-run card instead of on both its started and completed events, and attribute a failed poll to its call (cards) [upstreamable]
- omp: verify each web run on its own tool's step: `agy_read_url` answered only by `search_web` (agy 1.5.14 never offers `read_url_content` headlessly) is refused as unverified instead of returned as a page read (web-tools) [upstreamable]
- omp: resolve /agy tasks and /agy artifacts from the session's bound conversation, not the ACP driver's last settled session that auxiliary calls overwrite (commands)
- omp: make `/agy tasks tail <id>` reachable: the tasks branch no longer treats its own subcommand word as the first argument (commands) [upstreamable]
- omp: track agy 1.5.14 subagent spawns (`step_type: subagent`) on stream-json so `/agy subagents` lists them like on ACP (stream-json) [upstreamable]
- omp: maintain a moving `latest` release tag and publish a GitHub release on promotion (release)
- omp: publish an OMP marketplace catalog and a self-contained bundle with each release, so `omp plugin upgrade` picks up new releases (release)
- omp: point installs at the trozzelle/omp-plugins marketplace (docs)
- omp: replace upstream's README with a distilled OMP README; the sync keeps the fork's README and flags upstream doc changes (docs)
