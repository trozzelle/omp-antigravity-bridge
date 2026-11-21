#!/usr/bin/env bash
# Live checklist: drives the bridge in a real `omp` against an authenticated
# agy. Run before promoting a sync. Every check prints PASS or FAIL; the exit
# code is the number of failed checks (0 = all passed, 100 = could not start).
#
# Spends Antigravity quota (about a dozen tiny flash turns). Everything runs
# under a throwaway OMP profile (~/.omp/profiles/agy-smoke-<pid>) and a temp
# workspace, so the user's config, sessions and bridge state are not touched
# (omp still shares its machine-wide ~/.omp/natives and ~/.omp/run).
# The profile is deleted when every check passes; on failure it is kept for
# inspection and its bridge debug log path is printed.
#
# Usage: bash scripts/omp/smoke-live.sh
# Env:   SMOKE_MODEL (default antigravity/gemini-3-8-flash)
#        SMOKE_STEPS=1,3 (run only these numbered steps; the mcp_config check always runs)
#        STEP_TIMEOUT_SECS (default 300, per omp process), KEEP_PROFILE=1 (always keep)
#
# No pipefail: checks end in `grep -q`, which exits on the first match and
# would turn the upstream writer's SIGPIPE into a false failure.
set -u

cd "$(dirname "$0")/../.." || exit 100
root="$(pwd)"
model="${SMOKE_MODEL:-antigravity/gemini-3-8-flash}"
step_timeout="${STEP_TIMEOUT_SECS:-300}"
agy_bin="${AGY_BIN:-agy}"

abort() {
	echo "ABORT: $*" >&2
	exit 100
}

command -v omp >/dev/null 2>&1 || abort "omp not found on PATH"
command -v "$agy_bin" >/dev/null 2>&1 || abort "agy not found (set AGY_BIN)"
[[ -d node_modules/@modelcontextprotocol/sdk ]] || abort "dependencies missing; run npm install first"
"$agy_bin" models 2>/dev/null | grep -qi gemini || abort "agy lists no models; log in with agy first"

timeout_cmd=()
if command -v timeout >/dev/null 2>&1; then
	timeout_cmd=(timeout "$step_timeout")
elif command -v gtimeout >/dev/null 2>&1; then
	timeout_cmd=(gtimeout "$step_timeout")
fi

profile="agy-smoke-$$"
profile_dir="$HOME/.omp/profiles/$profile"
[[ ! -e "$profile_dir" ]] || abort "$profile_dir already exists"
bridge_logs="$profile_dir/extensions-data/estebanforge/pi-antigravity-bridge/logs"

scratch="$(mktemp -d)"
ws="$scratch/ws"
mkdir -p "$ws"
printf 'line1 alpha\nline2 bravo\nline3 charlie\nline4 delta\n' >"$ws/hello.txt"
probe_log="$scratch/probe.ndjson"
: >"$probe_log"

# Every model role points at the smoke model, so title, compaction and
# subagent calls never need credentials the throwaway profile lacks.
overlay="$scratch/roles.yml"
{
	echo "modelRoles:"
	for role in default plan slow advisor vision web task smol tiny commit memory; do
		echo "  $role: $model"
	done
} >"$overlay"
compact_overlay="$scratch/compact.yml"
printf 'compaction:\n  keepRecentTokens: 1\n' >"$compact_overlay"

mcp_config="$HOME/.gemini/config/mcp_config.json"
if [[ -e "$mcp_config" ]]; then
	cp "$mcp_config" "$scratch/mcp_config.before"
fi

failures=0
pass() { echo "PASS: $1"; }
fail() {
	echo "FAIL: $1 - $2"
	failures=$((failures + 1))
	if [[ -s "$scratch/step.out" || -s "$scratch/step.err" ]]; then
		echo "  --- last output ---"
		tail -n 20 "$scratch/step.out" "$scratch/step.err" 2>/dev/null | sed 's/^/  /'
	fi
}

# Line counts of the probe and bridge logs, taken before a step; *_since
# print only what the step appended.
mark() {
	probe_mark="$(wc -l <"$probe_log" | tr -d ' ')"
	bridge_mark="$(cat "$bridge_logs"/*.ndjson 2>/dev/null | wc -l | tr -d ' ')"
}
probe_since() { tail -n "+$((probe_mark + 1))" "$probe_log"; }
bridge_since() { cat "$bridge_logs"/*.ndjson 2>/dev/null | tail -n "+$((bridge_mark + 1))"; }

# omp_run <session-dir> <omp args...>: one omp process in the workspace with
# the bridge and the probe extension loaded; output in step.out / step.err.
omp_run() {
	local sessions="$1"
	shift
	(
		cd "$ws" &&
			AGY_DEBUG=1 OMP_PROBE_LOG="$probe_log" ${timeout_cmd[@]+"${timeout_cmd[@]}"} omp --profile "$profile" \
				--config "$overlay" --no-extensions --no-title \
				-e "$root" -e "$root/scripts/omp/probe-extension.ts" \
				--session-dir "$sessions" "$@"
	) >"$scratch/step.out" 2>"$scratch/step.err"
}

step_1() {
	local name="ACP turn"
	AGY_ENGINE=acp omp_run "$scratch/s1" -p --model "$model" "Reply with exactly: PONG"
	if grep -q "PONG" "$scratch/step.out"; then pass "$name"; else fail "$name" "reply lacks PONG"; fi
}

step_2() {
	local name="stream-json turn with native read"
	AGY_ENGINE=stream-json omp_run "$scratch/s2" -p --model "$model" \
		"Read lines 2-3 of hello.txt with your file viewing tool, then reply with exactly those two lines."
	if ! grep -q "line2 bravo" "$scratch/step.out" || ! grep -q "line3 charlie" "$scratch/step.out"; then
		fail "$name" "reply lacks line2/line3"
	elif ! probe_since | grep '"event":"tool_execution_end"' | grep '"toolName":"read"' | grep -q '"isError":false'; then
		fail "$name" "agy's read step was not re-executed through OMP's read tool"
	else
		pass "$name"
	fi
}

step_3() {
	local name="bridge tool round-trip"
	AGY_ENGINE=acp omp_run "$scratch/s3" -p --model "$model" \
		"Call the pi tool echo_probe through the Pi Bridge (bridge_call_tool) with text 'hi', then reply with exactly the tool's output."
	if ! probe_since | grep '"event":"echo_probe.execute"' | grep -q '"text":"hi"'; then
		fail "$name" "echo_probe was not executed with text hi"
	elif ! grep -q "ECHO_MARKER_7Q3 hi" "$scratch/step.out"; then
		fail "$name" "reply lacks ECHO_MARKER_7Q3 hi"
	else
		pass "$name"
	fi
}

step_4() {
	local name="long-call poll"
	AGY_ENGINE=acp omp_run "$scratch/s4" -p --model "$model" \
		"Call the pi tool slow_probe through the Pi Bridge with no arguments. It takes about 26 seconds; if you get a STILL RUNNING handle, poll bridge_poll_result until it finishes. Then reply with exactly the tool's output."
	if ! bridge_since | grep -q '"event":"call-tool-escalated"'; then
		fail "$name" "the call never escalated to a poll handle"
	elif ! grep -q "SLOW_MARKER_9W2" "$scratch/step.out"; then
		fail "$name" "reply lacks SLOW_MARKER_9W2"
	else
		pass "$name"
	fi
}

# check_denied <name>: the gated write did not happen and the bridge logged a deny.
check_denied() {
	if [[ -e "$ws/gate.txt" ]]; then
		fail "$1" "gate.txt was created"
	elif ! bridge_since | grep '"event":"approval-decision"' | grep -q '"decision":"deny"'; then
		fail "$1" "no deny decision in the bridge log (did agy attempt the write?)"
	else
		pass "$1"
	fi
	rm -f "$ws/gate.txt"
}

step_5() {
	local prompt="Create a file named gate.txt containing the single word hi using your file writing tool, then reply DONE."
	# Bridge policy deny (OMP stays in its default yolo mode).
	AGY_ENGINE=acp AGY_APPROVALS=dedicated AGY_APPROVALS_MODE=deny omp_run "$scratch/s5" -p --model "$model" "$prompt"
	check_denied "approval deny in print mode (approvals.mode deny)"
	# OMP approval mode: print mode cannot show the prompt, so it fails closed.
	mark
	AGY_ENGINE=acp omp_run "$scratch/s5b" -p --approval-mode always-ask --model "$model" "$prompt"
	check_denied "approval deny in print mode (--approval-mode always-ask)"
}

# Three turns over two processes: the first binds an agy conversation that must
# survive process exit; the second process compacts (rotating that binding)
# and asks a follow-up in the same run, which must still know the codeword.
step_6() {
	local name="/compact then follow-up"
	AGY_ENGINE=acp omp_run "$scratch/s6" -p --model "$model" "Remember this codeword: TANGERINE-41. Reply with exactly: NOTED"
	grep -q "NOTED" "$scratch/step.out" || {
		fail "$name" "first turn failed"
		return
	}
	mark
	AGY_ENGINE=acp omp_run "$scratch/s6" -c -p --model "$model" --config "$compact_overlay" \
		"/compact" \
		"What codeword did I give you earlier? Reply with just the codeword."
	if ! bridge_since | grep -q '"event":"session-compact-rotate"'; then
		fail "$name" "compaction did not rotate the agy binding saved by the first turn"
	elif ! grep -q "TANGERINE-41" "$scratch/step.out"; then
		fail "$name" "follow-up lost the codeword"
	else
		pass "$name"
	fi
}

# A scripted parent (probe/scripted) spawns a child, which runs on the smoke
# model through modelRoles.task. The parent then switches to the bridge and
# makes a bridged call in the same process. OMP keeps a finished child alive
# until the process exits, so this does not exercise child teardown; it
# exercises routing: echo_probe exists only in the main session's catalog, so
# the call fails if the parent's turn is served by the child's bridge state.
step_7() {
	local name="subagent turn"
	AGY_ENGINE=acp omp_run "$scratch/s7" -p --model probe/scripted \
		"SPAWN_CHILD" \
		"/probe-model $model" \
		"Call the pi tool echo_probe through the Pi Bridge (bridge_call_tool) with text 'after-child', then reply with exactly the tool's output."
	# Every session in the process shares one bridge listener: a second
	# listening port means the child started its own server beside the parent's.
	local listeners
	listeners="$(bridge_since | grep '"event":"listening"' | sed -E 's/.*"port":([0-9]+).*/\1/' | sort -u | tr '\n' ' ')"
	if ! probe_since | grep '"event":"scripted.done"' | grep -q 'CHILD_OK'; then
		fail "$name" "the child's antigravity turn did not return CHILD_OK"
	elif ! probe_since | grep '"event":"probe-model"' | grep -q '"ok":true'; then
		fail "$name" "could not switch the parent to $model"
	elif ! probe_since | grep '"event":"echo_probe.execute"' | grep -q '"text":"after-child"'; then
		fail "$name" "the parent's bridged call did not reach the main session's echo_probe (turn served by the child's bridge state?)"
	elif [[ "$(wc -w <<<"$listeners")" -gt 1 ]]; then
		fail "$name" "the child started its own bridge listener beside the parent's (ports: $listeners)"
	else
		pass "$name"
	fi
}

echo "smoke-live: omp $(omp --version 2>/dev/null), agy $("$agy_bin" --version 2>/dev/null | head -n 1), model $model, profile $profile"
want() { [[ -z "${SMOKE_STEPS:-}" || ",$SMOKE_STEPS," == *",$1,"* ]]; }
if want 1; then mark; step_1; fi
if want 2; then mark; step_2; fi
if want 3; then mark; step_3; fi
if want 4; then mark; step_4; fi
if want 5; then mark; step_5; fi
if want 6; then mark; step_6; fi
if want 7; then mark; step_7; fi

# The global agy MCP config is exactly as before (stream-json may register
# pi-bridge-<pid> entries there when it does not use its isolated home).
name="mcp_config.json unchanged"
: >"$scratch/step.out"
: >"$scratch/step.err"
if [[ -e "$scratch/mcp_config.before" ]]; then
	if cmp -s "$scratch/mcp_config.before" "$mcp_config"; then
		pass "$name"
	else
		fail "$name" "$mcp_config differs; remove only the pi-bridge-<pid> entries this run added"
	fi
elif [[ -e "$mcp_config" ]]; then
	fail "$name" "$mcp_config was created by this run"
else
	pass "$name"
fi

echo
echo "MANUAL (interactive, not automated): in a throwaway profile run"
echo "  omp --profile agy-test --no-extensions -e . --approval-mode always-ask --model $model"
echo "  approve one agy file write and deny another; check that /agy and /agy engine render."

if [[ $failures -eq 0 && "${KEEP_PROFILE:-}" != "1" ]]; then
	rm -rf "$profile_dir" "$scratch"
	rmdir "$HOME/.omp/profiles" 2>/dev/null || true
	echo "smoke-live: all checks passed"
else
	echo "smoke-live: $failures check(s) failed; kept profile $profile_dir and scratch $scratch"
	echo "smoke-live: bridge debug log: $bridge_logs"
fi
exit "$failures"
