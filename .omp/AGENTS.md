# omp-antigravity-bridge

OMP (oh-my-pi) port of [`@estebanforge/pi-antigravity-bridge`](https://github.com/EstebanForge/pi-extensions/tree/main/packages/pi-antigravity-bridge): a Gemini model provider plus the `AskAntigravity` delegation tool, built on Google's official `agy` CLI. This repository tracks upstream and carries a small stack of OMP-compatibility patches on top of it.

This file lives in `.omp/` on purpose: upstream ships its own root `AGENTS.md` and edits it often. Keeping fork guidance here means syncs never conflict on it. Upstream's codebase guide is imported below; it is written for pi. Where it conflicts with this file, this file wins.

@../AGENTS.md

## Branches and upstream sync

- `upstream`: output of `git subtree split --prefix=packages/pi-antigravity-bridge` over upstream `main`. Never edit, commit to, or rebase it by hand; only the sync flow fast-forwards it.
- `main`: `upstream` plus the OMP patch stack. Each sync rebases `main` onto the new `upstream` and force-pushes it. Releases are tagged `v<upstream-version>-omp.<N>` and stay reachable; the annotated `latest` tag is force-moved to the newest release (by `promote-sync.yml`, together with a GitHub release marked latest). Never point `latest` at anything but a release tag's commit.
- `v<release>-bundle` tags: for each release, `promote-sync.yml` runs `scripts/omp/marketplace-release.sh <tag> --push`, which commits a prebuilt `dist/omp-antigravity-bridge.js` (built by `scripts/omp/build-bundle.mjs`, `dist/` is gitignored on main) plus a `package.json` whose `omp.extensions` points at it on top of the release commit, tags that commit `<tag>-bundle`, and uploads `marketplace.json` to the GitHub release (`scripts/omp/marketplace-catalog.mjs`). These commits are not on `main`. Marketplace installs clone the `-bundle` tag and never run `npm install`, so the bundle must inline every runtime dependency; `scripts/omp/smoke-bundle.sh` (run by CI) loads it from a layout with no `node_modules`. The catalog `version` is the release tag minus `v`; `omp plugin upgrade` needs it to be semver-newer than the installed one, which the `-omp.<N>` counter guarantees. Never delete or move a `-bundle` tag a published catalog points at.
- Marketplace: users add the separate repository `trozzelle/omp-plugins` (catalog at `.omp-plugin/marketplace.json`, marketplace name `trozzelle`). Its own **Sync catalog** workflow (every six hours and on demand) copies the plugin entry from this repository's latest release `marketplace.json` asset and commits it, so nothing here pushes to that repository. Keep publishing the asset with every release; renaming the plugin or marketplace breaks existing installs.
- `sync/<upstream-short-sha>`: candidate branches produced by the sync workflow. Promotion to `main` is a separate, deliberate step.
- To change behaviour, amend or add a commit in the patch stack. Never rewrite upstream commits.

## Patch conventions

- One commit per area, subject prefixed `omp:`. Keep each commit independently reviewable and rebasable.
- Put OMP-specific logic in new files under `src/omp/`. Upstream files get only short call-outs into `src/omp/`, which keeps rebase conflicts small.
- Detect the host through the single helper in `src/omp/host.ts`. Every OMP branch is feature-checked, so behaviour under pi stays unchanged and the upstream test suite stays green.
- Keep host-independent bug fixes in their own commits and mark them `[upstreamable]` in `CHANGELOG-OMP.md`, so they can be offered upstream and dropped from the stack once merged.
- Every patch commit gets a `CHANGELOG-OMP.md` entry.
- Do not move or rename upstream files. Do not rename the data and log directories (`…/extensions-data/estebanforge/pi-antigravity-bridge`); existing installs depend on them.

## OMP versus pi: host facts the patches rely on

OMP loads pi extensions through a compatibility layer that rewrites `@earendil-works/*` imports to OMP's own copies. These differences from pi are verified against OMP 19.1.0:

- **Runtime is Bun, not Node.** Function declarations inside `switch`/block bodies can hit temporal-dead-zone errors under Bun that Node tolerates. Declare helpers at module scope.
- **Missing APIs.** `generateDiffString` is not exported. `pi.registerEntryRenderer` and the `model_select` event do not exist. `appendEntry` rows are never drawn. Display-only rows use `pi.registerMessageRenderer` plus `pi.sendMessage({ display: true, excludeFromContext: true, … })`.
- **Context shape.** The system prompt arrives as `context.systemPrompt: string[]`, never as a `system` message, and tools arrive as `context.tools`. Custom and extension messages use role `developer` where pi uses `user`.
- **Tool schemas.** `getAllTools()` returns `parameters` as schema objects exposing `.toJsonSchema()`, not plain JSON schema. MCP tools carry `source: "mcp"`.
- **Builtin tools differ.** `read` takes a `path:START-END` selector instead of offset/limit. There is no `ls`; listing a directory is `read` on it. OMP's `find` is a semantic search; the glob equivalent is `glob`. `edit` is hashline-based. Never register tools that shadow OMP builtins.
- **Subagents.** OMP re-runs the extension factory for every subagent session in the same process, with shared module state and a process-wide provider registry. Process-lifetime resources (drivers, MCP server, session store) must be singletons with refcounted teardown. Use `ctx.agent.kind === "main"` for once-per-process side effects.
- **One-shot model calls.** Compaction, branch-summary and title calls reuse the live session id without `cacheRetention: "none"`. `/btw` side turns use session ids containing `:side:`. Neither may bind an agy conversation.
- **Approval.** Read OMP's approval settings (`tools.approvalMode`, `tools.approval`, `tools.restrictedFolders`) with `lookup()` from `@oh-my-pi/pi-coding-agent/config/registry`, passing `pi.pi.settings` as the scope.
- **Skills.** `pi.getCommands()` filtered to `source: "skill"` lists the session's real skills. Directory scans miss plugin-provided skills.

## Verification

- `npm run typecheck`: TypeScript against upstream pi dev dependencies.
- `npm test`: upstream Vitest suite plus `tests/omp/*.test.ts` (OMP-shaped contexts, schemas, approval tool, singleton teardown).
- `npm run test:bun`: the suite under the Bun runtime, which catches Bun-only failures.
- `npm run smoke:omp`: loads the extension in a real `omp` with no extension discovery and checks that `antigravity/*` models register with zero load errors. Works without `agy`, using the fallback catalog.
- `bash scripts/omp/smoke-bundle.sh`: builds the marketplace bundle and runs the load smoke on a `package.json` + `dist/` layout with no `node_modules` (needs `bun`).
- `bash scripts/omp/smoke-live.sh`: manual live checklist. Needs an authenticated `agy`; run it before promoting a sync. Keep prompts tiny, because they spend Antigravity quota.

Install dependencies with `npm install --legacy-peer-deps`.

## Live testing safety

- Load the working tree explicitly: `omp --no-extensions -e . …`. Never install this plugin globally to test it.
- Run interactive TUI probes under a throwaway profile (`omp --profile agy-test …`). Pickers such as `/model` write the user's real `config.yml` when Enter is pressed.
- The stream-json engine registers `pi-bridge-<pid>` entries in `~/.gemini/config/mcp_config.json`. After a test, confirm they were swept, and remove only entries your run created.
- The bridge's debug log is at `~/.omp/extensions-data/estebanforge/pi-antigravity-bridge/logs/<date>.ndjson`; enable the full trail with `AGY_DEBUG=1`.
