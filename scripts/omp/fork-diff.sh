#!/usr/bin/env bash
# The fork's footprint on upstream's own files: lines added and removed in
# files that exist in the upstream version HEAD is merged with. Fork-only
# files (src/omp, tests/omp, scripts/omp, ...) never conflict on a sync, so
# they are not counted; neither are package.json and README.md, which the
# sync resolves by itself (scripts/omp/sync-upstream.sh).
#
# Usage: fork-diff.sh [--upstream REF] [--base REF] [--list] [--worktree | HEAD]
#   --upstream  the upstream subtree split (default origin/upstream, else upstream)
#   --worktree  measure the working tree (uncommitted edits included)
#   --base      also measure REF and report the change from it (CI: the PR base)
#   --list      print per-file counts, largest first
#
# Prints key=value lines (files, added, removed, total; with --base also
# base_total and delta). Under GitHub Actions it appends a summary table to
# $GITHUB_STEP_SUMMARY and warns when a pull request grows the footprint.
# Report only: it exits 0 whatever the size.

set -euo pipefail

upstream_ref=""
base_ref=""
list=false
worktree=false
head_ref="HEAD"
while [ $# -gt 0 ]; do
	case "$1" in
		--upstream) upstream_ref="$2"; shift 2 ;;
		--base) base_ref="$2"; shift 2 ;;
		--list) list=true; shift ;;
		--worktree) worktree=true; shift ;;
		-*) echo "fork-diff: unknown option $1" >&2; exit 2 ;;
		*) head_ref="$1"; shift ;;
	esac
done

if [ -z "$upstream_ref" ]; then
	if git rev-parse --verify --quiet origin/upstream >/dev/null; then upstream_ref=origin/upstream; else upstream_ref=upstream; fi
fi
git rev-parse --verify --quiet "$upstream_ref" >/dev/null || { echo "fork-diff: no upstream ref $upstream_ref" >&2; exit 2; }

# numstat of upstream-owned files between the upstream version REF merged and
# REF itself (the working tree with a second argument "worktree"):
# "<added>\t<removed>\t<path>" per file.
numstat() {
	local ref="$1" mb to=("$1")
	[ "${2:-}" = worktree ] && to=()
	mb="$(git merge-base "$upstream_ref" "$ref")" || { echo "fork-diff: $ref shares no history with $upstream_ref" >&2; exit 2; }
	# First input: upstream's file list; second: the numstat.
	awk -F '\t' '
			NR == FNR { up[$0] = 1; next }
			($3 in up) && $3 != "package.json" && $3 != "README.md" {
				# Binary files report "-": count them as one changed line each way.
				printf "%s\t%s\t%s\n", ($1 == "-" ? 1 : $1), ($2 == "-" ? 1 : $2), $3
			}' <(git ls-tree -r --name-only "$mb") <(git diff --no-renames --numstat "$mb" ${to[@]+"${to[@]}"})
}

totals() { awk -F '\t' '{ a += $1; r += $2; n++ } END { printf "%d %d %d\n", n, a, r }'; }

head_stat="$(numstat "$head_ref" "$($worktree && echo worktree)")"
read -r files added removed <<<"$(printf '%s' "$head_stat" | totals)"
total=$((added + removed))
echo "files=$files"
echo "added=$added"
echo "removed=$removed"
echo "total=$total"

delta=""
if [ -n "$base_ref" ]; then
	read -r _ base_added base_removed <<<"$(numstat "$base_ref" | totals)"
	base_total=$((base_added + base_removed))
	delta=$((total - base_total))
	echo "base_total=$base_total"
	echo "delta=$delta"
fi

if $list; then
	printf '%s\n' "$head_stat" | awk -F '\t' 'NF { printf "%6d %6d  %s\n", $1, $2, $3 }' | sort -k1,1nr -k2,2nr
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
	{
		echo "### Fork footprint on upstream files"
		echo
		echo "$files files, +$added / -$removed ($total lines) against \`$upstream_ref\`$([ -n "$delta" ] && printf '; %+d from `%s`' "$delta" "$base_ref")."
		echo
		echo "| + | - | file |"
		echo "|--:|--:|------|"
		printf '%s\n' "$head_stat" | awk -F '\t' 'NF { printf "| %d | %d | `%s` |\n", $1, $2, $3 }' | sort -t '|' -k2,2nr | head -n 15
	} >>"$GITHUB_STEP_SUMMARY"
fi

if [ -n "$delta" ] && [ "$delta" -gt 0 ]; then
	echo "::warning title=Fork footprint grew::This change adds $delta lines of fork changes to upstream's files (now $total). Prefer a hook in src/omp/ when you can; each changed line in a shared file can conflict on the next upstream sync."
fi
