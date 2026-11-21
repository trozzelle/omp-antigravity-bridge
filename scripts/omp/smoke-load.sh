#!/usr/bin/env bash
# Load smoke: load this package into a real `omp` with extension discovery off
# and check that the antigravity provider registers with zero load errors.
#
# Hermetic: HOME points at a throwaway dir, so omp's config, sessions, caches
# and the bridge's own state land there instead of ~/.omp; AGY_BIN points at a
# missing binary, so the bridge always registers its fallback catalog
# (FALLBACK_MODELS in src/models.ts) whether or not agy is installed.
#
# Usage: npm run smoke:omp   (or: bash scripts/omp/smoke-load.sh)
# Env:   OMP_BIN (default: omp on PATH), SMOKE_TIMEOUT_SECS (default 120)
set -euo pipefail

cd "$(dirname "$0")/../.."
root="$(pwd)"

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

omp_bin="${OMP_BIN:-$(command -v omp || true)}"
[[ -n "$omp_bin" ]] || fail "omp not found on PATH (install: bun install -g @oh-my-pi/pi-coding-agent)"
[[ -d node_modules/@modelcontextprotocol/sdk ]] || fail "dependencies missing; run npm install first"

# Expected models: every id in FALLBACK_MODELS, as antigravity/<id>.
expected="$(awk '
	/^export const FALLBACK_MODELS/ { on = 1; next }
	on && /^\];/ { exit }
	on { if (match($0, /id: "[^"]+"/)) print "antigravity/" substr($0, RSTART + 5, RLENGTH - 6) }
' src/models.ts | sort)"
[[ -n "$expected" ]] || fail "could not read FALLBACK_MODELS ids from src/models.ts"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/home"

# omp_isolated <args...>: omp with a throwaway HOME and no inherited profile,
# agent-dir or XDG overrides, bounded by SMOKE_TIMEOUT_SECS when a timeout
# command exists (GNU timeout, or gtimeout from Homebrew coreutils).
omp_isolated() {
	local limit=()
	if command -v timeout >/dev/null 2>&1; then
		limit=(timeout "${SMOKE_TIMEOUT_SECS:-120}")
	elif command -v gtimeout >/dev/null 2>&1; then
		limit=(gtimeout "${SMOKE_TIMEOUT_SECS:-120}")
	fi
	${limit[@]+"${limit[@]}"} env -u PI_CODING_AGENT_DIR -u PI_CONFIG_DIR -u OMP_PROFILE -u PI_PROFILE \
		-u XDG_CONFIG_HOME -u XDG_DATA_HOME -u XDG_STATE_HOME -u XDG_CACHE_HOME \
		HOME="$scratch/home" AGY_BIN="$scratch/no-agy" "$omp_bin" "$@"
}

echo "smoke: $(omp_isolated --version 2>/dev/null || echo "omp ?") loading $root"
set +e
# `models` flags must follow the subcommand: placed before it, -e is silently ignored.
omp_isolated models find antigravity --json --no-extensions -e "$root" >"$scratch/stdout" 2>"$scratch/stderr"
rc=$?
set -e

show_output() {
	echo "--- stdout ---" >&2
	head -c 4000 "$scratch/stdout" >&2
	echo >&2
	echo "--- stderr ---" >&2
	head -c 4000 "$scratch/stderr" >&2
}

[[ $rc -ne 124 ]] || { show_output; fail "omp timed out after ${SMOKE_TIMEOUT_SECS:-120}s"; }
[[ $rc -eq 0 ]] || { show_output; fail "omp exited $rc"; }
if grep -q "Failed to load extension" "$scratch/stdout" "$scratch/stderr"; then
	show_output
	fail "omp reported an extension load error"
fi

actual="$(node -e '
	const out = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
	for (const m of out.models ?? []) if (m.provider === "antigravity") console.log(m.selector);
' "$scratch/stdout" | sort)" || { show_output; fail "omp output is not the expected JSON"; }

if [[ "$actual" != "$expected" ]]; then
	show_output
	echo "--- expected ---" >&2
	echo "$expected" >&2
	echo "--- actual ---" >&2
	echo "${actual:-<none>}" >&2
	fail "antigravity models differ from FALLBACK_MODELS"
fi

echo "PASS: $(wc -l <<<"$actual" | tr -d ' ') antigravity models registered, no extension load errors"
while IFS= read -r selector; do echo "  $selector"; done <<<"$actual"
