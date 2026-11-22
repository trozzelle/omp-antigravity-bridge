#!/usr/bin/env bash
# Publish the marketplace artifacts for one release.
#
# OMP's marketplace installer clones a plugin's git source and never runs an
# npm install, so the plugin tree it clones must already contain everything it
# needs. For release tag <tag> this script:
#   1. checks the tag's commit out in a temp worktree and installs its
#      dependencies,
#   2. bundles the extension into dist/omp-antigravity-bridge.js,
#   3. commits the bundle (force-added past .gitignore) and a package.json
#      whose omp.extensions points at it, on top of the release commit,
#   4. tags that commit <tag>-bundle (annotated),
#   5. writes marketplace.json whose single plugin entry pins that tag and sha.
# main is never modified. The build recipe (bundler, manifest rewrite, catalog
# generator) always comes from this checkout, so older tags can be bundled.
#
# Without --push everything stays local and the paths are printed. With --push
# the bundle tag is pushed and marketplace.json is uploaded to the GitHub
# release <tag> (replacing an earlier upload), which is what
# releases/latest/download/marketplace.json serves.
#
# Usage: bash scripts/omp/marketplace-release.sh <release-tag> [--push]
# Env:   MARKETPLACE_OUT  catalog output path (default: dist/marketplace.json)
set -euo pipefail

usage() {
	echo "usage: marketplace-release.sh <release-tag, e.g. v1.13.1-omp.4> [--push]" >&2
	exit 2
}

tag=""
push=0
for arg in "$@"; do
	case "$arg" in
		--push) push=1 ;;
		-*) usage ;;
		*) [[ -z "$tag" ]] || usage; tag="$arg" ;;
	esac
done
[[ -n "$tag" ]] || usage
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-omp\.[0-9]+$ ]] || { echo "error: '$tag' is not a release tag (v<upstream-version>-omp.<N>)" >&2; exit 2; }

tools="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$tools/../.." && pwd)"
bundle_tag="${tag}-bundle"
out="${MARKETPLACE_OUT:-$repo/dist/marketplace.json}"

cd "$repo"
release_sha="$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}")" || { echo "error: tag $tag not found" >&2; exit 1; }
if git rev-parse --verify --quiet "refs/tags/${bundle_tag}" >/dev/null; then
	echo "error: tag $bundle_tag already exists; delete it to rebuild" >&2
	exit 1
fi

scratch="$(mktemp -d)"
worktree="$scratch/tree"
cleanup() {
	git -C "$repo" worktree remove --force "$worktree" >/dev/null 2>&1 || true
	rm -rf "$scratch"
}
trap cleanup EXIT

git worktree add --quiet --detach "$worktree" "$release_sha"
(
	cd "$worktree"
	npm install --no-audit --no-fund --loglevel=error
	rm -f package-lock.json
	bun "$tools/build-bundle.mjs" "$worktree"
	node "$tools/bundle-manifest.mjs" package.json package.json
	git add package.json
	git add -f dist/omp-antigravity-bridge.js
	git commit --quiet -m "omp: marketplace bundle for ${tag}"
	git tag -a "$bundle_tag" -m "Marketplace bundle for ${tag}"
)
bundle_sha="$(git rev-parse "refs/tags/${bundle_tag}^{commit}")"

mkdir -p "$(dirname "$out")"
node "$tools/marketplace-catalog.mjs" --version "$tag" --ref "$bundle_tag" --sha "$bundle_sha" --out "$out"

echo "release commit: $release_sha ($tag)"
echo "bundle commit:  $bundle_sha ($bundle_tag)"
echo "catalog:        $out"

if [[ $push -eq 1 ]]; then
	[[ "$(basename "$out")" == "marketplace.json" ]] || { echo "error: the release asset must be named marketplace.json" >&2; exit 1; }
	git push origin "refs/tags/${bundle_tag}"
	gh release upload "$tag" "$out" --clobber
	echo "published: $bundle_tag pushed, marketplace.json attached to release $tag"
else
	echo "local only (no --push): nothing was pushed or uploaded"
fi
