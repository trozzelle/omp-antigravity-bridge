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
