#!/usr/bin/env bash
# Sync the fork with upstream.
#
#   1. Clone the upstream monorepo (full history) into a temp dir and run
#      `git subtree split --prefix=packages/pi-antigravity-bridge`. The split
#      is deterministic, so an unchanged upstream yields the same commit.
#   2. Fast-forward the local `upstream` branch to the split tip.
#   3. Create `sync/<short-sha>` = `main` with `upstream` merged in (a merge
#      commit; main is never rewritten). Conflicts in fork-owned files resolve
#      automatically: package.json takes upstream's file and re-runs
#      scripts/omp/apply-package-overrides.mjs; README.md keeps the fork's
#      README (upstream's stays on the upstream branch). Any other conflict
#      aborts the merge and names the fork commits that touched the
#      conflicted files.
#
# main must contain `upstream`: the sync pull request is merged with a merge
# commit. A squash or rebase merge drops upstream from main's history, and the
# next run refuses to sync until upstream is merged back in by hand.
#
# Run from the root of a clone of the fork with a clean worktree and a git
# identity configured. Local branches `upstream` and `main` are created from
# origin/<name> when missing. Pushing is left to the caller.
#
# Environment:
#   UPSTREAM_URL       upstream monorepo (default EstebanForge/pi-extensions)
#   UPSTREAM_REF       upstream branch to split (default main)
#   UPSTREAM_PREFIX    package path inside the monorepo
#   UPSTREAM_REPO_DIR  use this existing full clone instead of cloning
#   SYNC_REMOTE        remote holding pending sync branches (default origin)
#   SYNC_OUT_DIR       where result files go (default <git-dir>/omp-sync)
#   FORCE=1            rebuild sync/<sha> even if <remote>/sync/<sha> exists
#
# Exit codes: 0 up to date, pending, or synced; 1 error; 3 merge conflict.
# Result keys (status, sha, branch, upstream_sha, upstream_version, base_sha,
# base_version, main_sha, fork_commits, conflict_files) are printed as
# key=value lines and appended to $GITHUB_OUTPUT when set.
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/EstebanForge/pi-extensions.git}"
UPSTREAM_REF="${UPSTREAM_REF:-main}"
UPSTREAM_PREFIX="${UPSTREAM_PREFIX:-packages/pi-antigravity-bridge}"
SYNC_REMOTE="${SYNC_REMOTE:-origin}"
OVERRIDES_SCRIPT="scripts/omp/apply-package-overrides.mjs"

die() {
	echo "sync-upstream: $*" >&2
	exit 1
}

emit() {
	echo "$1=$2"
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "$1=$2" >>"$GITHUB_OUTPUT"
	fi
}

pkg_version() {
	git show "$1:package.json" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(String(JSON.parse(s).version))})'
}

ensure_branch() {
	if git show-ref --verify --quiet "refs/heads/$1"; then
		return
	fi
	if git show-ref --verify --quiet "refs/remotes/$SYNC_REMOTE/$1"; then
		git branch --quiet "$1" "refs/remotes/$SYNC_REMOTE/$1"
		return
	fi
	die "branch '$1' not found locally or on $SYNC_REMOTE"
}

cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet || ! git diff --cached --quiet; then
	die "worktree has uncommitted changes"
fi
[[ -z "$(git ls-files --others --exclude-standard)" ]] || die "worktree has untracked files"
git var GIT_COMMITTER_IDENT >/dev/null 2>&1 || die "no git identity; set user.name and user.email"
[[ -x "$(git --exec-path)/git-subtree" ]] || die "git subtree is not installed (it ships in git's contrib)"
if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
	die "a rebase is already in progress"
fi
git rev-parse -q --verify MERGE_HEAD >/dev/null && die "a merge is already in progress"
ensure_branch upstream
ensure_branch main
start_ref="$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)"
[[ "$start_ref" != "upstream" ]] || die "do not run with the upstream branch checked out"

out_dir="${SYNC_OUT_DIR:-$(git rev-parse --absolute-git-dir)/omp-sync}"
mkdir -p "$out_dir"
rm -f "$out_dir/changelog-delta.md" "$out_dir/conflict.txt"

work="$(mktemp -d)"
cleanup() {
	rm -rf "$work"
}
trap cleanup EXIT

# 1. Split.
if [[ -n "${UPSTREAM_REPO_DIR:-}" ]]; then
	up_dir="$(cd "$UPSTREAM_REPO_DIR" && pwd)"
else
	up_dir="$work/upstream"
	echo "sync-upstream: cloning $UPSTREAM_URL ($UPSTREAM_REF)" >&2
	git clone --quiet --no-tags --single-branch --branch "$UPSTREAM_REF" "$UPSTREAM_URL" "$up_dir"
fi
[[ "$(git -C "$up_dir" rev-parse --is-shallow-repository)" == "false" ]] ||
	die "$up_dir is a shallow clone; the split needs full history to reproduce the upstream branch"
up_tip="$(git -C "$up_dir" rev-parse --verify "$UPSTREAM_REF^{commit}")"
echo "sync-upstream: splitting $UPSTREAM_PREFIX at ${up_tip:0:12}" >&2
split="$(git -C "$up_dir" subtree split --prefix="$UPSTREAM_PREFIX" "$up_tip" 2>"$work/split.log")" || {
	cat "$work/split.log" >&2
	die "git subtree split failed"
}
[[ "$split" =~ ^[0-9a-f]{40}$ ]] || die "unexpected split output: $split"
git -C "$up_dir" update-ref refs/omp-sync/split "$split"
git fetch --quiet --no-tags "$up_dir" refs/omp-sync/split
git -C "$up_dir" update-ref -d refs/omp-sync/split
[[ "$(git rev-parse FETCH_HEAD)" == "$split" ]] || die "fetched split does not match $split"

short="$(git rev-parse --short=7 "$split")"
branch="sync/$short"
old_upstream="$(git rev-parse upstream)"
main_sha="$(git rev-parse main)"
emit upstream_sha "$split"
emit sha "$short"
emit main_sha "$main_sha"

# A sync branch already on the remote (pushed by hand after resolving a
# conflict, or left by an earlier run) is reported below, not rebuilt.
pending=0
if [[ "${FORCE:-}" != "1" ]] && git show-ref --verify --quiet "refs/remotes/$SYNC_REMOTE/$branch"; then
	pending=1
fi

# main must contain upstream, except while a sync is pending: resolving a
# conflict by hand pushes upstream ahead of main together with the sync branch,
# and main catches up when that branch's pull request merges.
if ! git merge-base --is-ancestor "$old_upstream" main; then
	[[ $pending -eq 1 && "$split" == "$old_upstream" ]] ||
		die "main does not contain upstream ${old_upstream:0:7}; was a sync pull request squash- or rebase-merged? Merge upstream into main by hand (git merge upstream) before syncing again"
elif [[ "$split" == "$old_upstream" ]]; then
	emit status up-to-date
	echo "sync-upstream: upstream unchanged at $short; main already contains it" >&2
	exit 0
fi

# 2. Fast-forward upstream.
if [[ "$split" != "$old_upstream" ]]; then
	git merge-base --is-ancestor "$old_upstream" "$split" ||
		die "split $short does not descend from upstream ${old_upstream:0:7}; upstream history was rewritten"
	git update-ref refs/heads/upstream "$split" "$old_upstream"
	echo "sync-upstream: upstream ${old_upstream:0:7} -> $short" >&2
fi

base="$(git merge-base main upstream)"
upstream_version="$(pkg_version upstream)"
base_version="$(pkg_version "$base")"
emit upstream_version "$upstream_version"
emit base_sha "$base"
emit base_version "$base_version"

# Upstream changelog sections added since the version main is based on.
git show upstream:CHANGELOG.md 2>/dev/null |
	awk -v old="## [$base_version]" '
		index($0, old) == 1 { exit }
		/^## \[/ { started = 1 }
		started { print }
	' >"$out_dir/changelog-delta.md" || true

# A pending sync branch is reported, not rebuilt. The result keys above are
# emitted first so the caller can still open its pull request.
if [[ $pending -eq 1 ]]; then
	emit status pending
	emit branch "$branch"
	echo "sync-upstream: $SYNC_REMOTE/$branch already exists (set FORCE=1 to rebuild)" >&2
	exit 0
fi

# 3. Merge upstream into main.
git switch --quiet -C "$branch" main
merge_msg="sync: merge upstream $upstream_version ($short)"
status=0
git -c core.editor=true -c rerere.enabled=false \
	merge --no-ff --no-edit -m "$merge_msg" upstream >>"$work/merge.log" 2>&1 || status=$?
if [[ $status -ne 0 ]]; then
	git rev-parse -q --verify MERGE_HEAD >/dev/null || {
		cat "$work/merge.log" >&2
		git switch --quiet "$start_ref"
		git branch --quiet -D "$branch"
		die "git merge failed without stopping on a conflict"
	}
	conflicts="$(git diff --name-only --diff-filter=U)"
	# Fork-owned files: package.json is upstream's file plus the overrides;
	# README.md is the fork's own README (upstream's stays on the upstream branch).
	auto=1
	while IFS= read -r file; do
		case "$file" in
		package.json) [[ -f "$OVERRIDES_SCRIPT" ]] || auto=0 ;;
		README.md) ;;
		*) auto=0 ;;
		esac
	done <<<"$conflicts"
	if [[ $auto -eq 0 || -z "$conflicts" ]]; then
		cat "$work/merge.log" >&2
		git merge --abort
		git switch --quiet "$start_ref"
		git branch --quiet -D "$branch"
		files="$(echo "$conflicts" | paste -sd ' ' -)"
		# The fork commits since the last sync that touched the conflicted files.
		# shellcheck disable=SC2086 # word-split the file list into pathspecs
		fork_commits="$(git log --no-merges --format='%h %s' "$base..main" -- $files | paste -sd ';' - | sed 's/;/; /g')"
		{
			echo "fork_commits=$fork_commits"
			echo "conflict_files=$files"
		} >"$out_dir/conflict.txt"
		emit status conflict
		emit fork_commits "$fork_commits"
		emit conflict_files "$files"
		echo "sync-upstream: CONFLICT merging upstream $short into main" >&2
		echo "sync-upstream: conflicted files: $files" >&2
		exit 3
	fi
	if grep -qx 'package.json' <<<"$conflicts"; then
		echo "sync-upstream: package.json conflict, taking upstream's file and re-applying overrides" >&2
		git show upstream:package.json >package.json
		node "$OVERRIDES_SCRIPT"
		git add package.json
	fi
	if grep -qx 'README.md' <<<"$conflicts"; then
		echo "sync-upstream: README.md conflict, keeping the fork's README" >&2
		git checkout --ours -- README.md
		git add README.md
	fi
	git -c core.editor=true commit --quiet --no-edit >>"$work/merge.log" 2>&1
fi
# A clean merge can still combine upstream's package.json edits with the fork's
# in a way the overrides would not produce; the overrides own the file.
if [[ -f "$OVERRIDES_SCRIPT" ]]; then
	node "$OVERRIDES_SCRIPT"
	if ! git diff --quiet -- package.json; then
		git add package.json
		git -c core.editor=true commit --quiet --amend --no-edit
	fi
fi

git switch --quiet "$start_ref"
emit status synced
emit branch "$branch"
echo "sync-upstream: created $branch (upstream $short merged into main, version $upstream_version)" >&2
