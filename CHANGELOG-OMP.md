# Changelog (OMP patch stack)

Changes this fork carries on top of upstream `@estebanforge/pi-antigravity-bridge`. Entries marked `[upstreamable]` are host-independent fixes offered upstream; they leave this list once upstream ships them.

## Unreleased

- omp: add fork guidance and ignore rules (repo)
- omp: package as omp-antigravity-bridge with a standalone test harness (packaging)
- omp: hoist ACP activity helpers out of the switch and sort ACP cleanup listings for Bun (runtime) [upstreamable]
- omp: detect the OMP host and load without generateDiffString or registerEntryRenderer (load)
- omp: upstream sync automation, CI workflows, load smoke and live checklist (sync)
- omp: read OMP's system prompt, tools and developer-role messages (context)
- omp: keep OMP one-shot calls and side turns off the session's conversation and recognise OMP compaction summaries (compaction)
- omp: route OMP subagents through upstream's realm runtime: unknown session ids ride the main session, one-shot calls and side turns get their own agy process, worker-thread realms tag their per-pid files (runtime)
- omp: send real tool schemas to agy, match OMP MCP tools in `mcp` mode, never bridge OMP harness tools (catalog)
- omp: re-execute agy read steps on OMP `read` selectors, `list_dir` on `read`, `find_by_name` on `glob`, without the pi-only reasoning argument (re-exec)
- omp: draw native-event and poll-run cards as display-only messages (cards)
- omp: dedicated approval tool deferring to the host approval mode; approvals.mode inherit; gate auto and ACP permission policy follow host approval settings (approval)
- omp: build the activate_skill catalog from the session's skill commands (skills) [upstreamable]
- omp: show the first-run engine picker and the model-switch handoff toast, skip patch-cleanup (ui-events)
- omp: claim AskAntigravity at import time so pi-ask-antigravity defers in any load order under OMP's batch loader (interop)
- omp: print /agy doctor to stdout in headless print mode (doctor) [upstreamable]
- omp: document installing and using the bridge with OMP (docs)
- omp: keep the user's message and OMP summary messages out of the digest (context)
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
- omp: rewrite the README in plain prose, correct `AGY_EXTRA_ARGS` (it applies to `AskAntigravity` runs only) and document the agy version floors, setting values and `/agy` commands (docs)
- omp: native-event sinks may return text the provider appends to the reply's thinking at the step's position, for started, completed and failed steps alike (cards) [upstreamable]
- omp: show agy's native ACP steps as trace lines in the reply's thinking, in order, instead of cards OMP queues below the finished reply; `acp.nativeSteps` / `AGY_NATIVE_STEPS` / `/agy steps inline|cards` keeps cards available (cards)
- omp: keep native-event and poll-run card messages out of the model's context; OMP sends custom messages as developer messages regardless of `excludeFromContext` (cards)
- omp: rebase onto upstream 1.13.3: the prompt reads upstream's trailing user run with OMP developer messages and summaries, and the activate_skill catalog tolerates a host without a command list (sync)
- omp: release every pull request merged into main once CI passes on the merge commit, with the next `v<version>-omp.<N>` tag, `latest`, a GitHub release and the marketplace bundle; `skip-release` opts a pull request out (release)
- omp: sync upstream by merging it into main instead of rebasing the fork onto it: main is never rewritten, sync pull requests are merged (with a merge commit) and released like any other, Promote sync is retired, and the sync refuses to run once main stops containing upstream (sync)
- omp: shrink the fork's changes to upstream files: one `src/omp/index.ts` import in `extensions/index.ts`, OMP config knobs in `src/omp/config.ts`, and one-line hooks (`src/omp/extension.ts`, `isOmpSummaryText`, `ompReexecArgs`) for the factory, prompt and re-exec branches; CI reports the footprint (`scripts/omp/fork-diff.sh`) and warns when a pull request grows it (sync)
- omp: load on OMP 19.2, which refuses `@earendil-works/pi-tui` anywhere in an extension's import graph: tool and card renders return width-wrapped rows objects, the `/agy` settings menu, engine picker and artifact/task browsers use OMP's native selector, and the pi dialog kit loads only under pi (load)
- omp: add the `smoke:pi` npm script the contributor guides document; it runs `scripts/smoke-in-pi.sh` (packaging) [upstreamable]
