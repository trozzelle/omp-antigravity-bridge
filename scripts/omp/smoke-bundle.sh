#!/usr/bin/env bash
# Bundle load smoke: build the marketplace bundle, lay it out exactly as the
# marketplace install sees it (package.json + dist/, no node_modules) in a temp
# dir, and run the load smoke against that dir. Fails if bundling left a
# dependency out.
#
# Usage: bash scripts/omp/smoke-bundle.sh   (needs bun and omp on PATH)
set -euo pipefail

cd "$(dirname "$0")/../.."

bun scripts/omp/build-bundle.mjs

layout="$(mktemp -d)"
trap 'rm -rf "$layout"' EXIT
mkdir "$layout/dist"
cp dist/omp-antigravity-bridge.js "$layout/dist/"
node scripts/omp/bundle-manifest.mjs package.json "$layout/package.json"

bash scripts/omp/smoke-load.sh "$layout"
