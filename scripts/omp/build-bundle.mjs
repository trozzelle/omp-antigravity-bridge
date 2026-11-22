#!/usr/bin/env bun
// Bundles the extension into one self-contained ESM file for marketplace
// installs. OMP's marketplace installer clones the plugin tree but never runs
// an npm install, so every runtime dependency (MCP SDK, @estebanforge/*, diff)
// is inlined; only packages the host provides stay external, and OMP rewrites
// those imports at load time.
//
// Usage: bun scripts/omp/build-bundle.mjs [source-root]   (npm run build:bundle)
// source-root defaults to this checkout; the release script points it at a
// worktree of an older release while keeping the build recipe from here.
import { mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
export const BUNDLE_PATH = "dist/omp-antigravity-bridge.js";

// Provided by the host at load time. Node builtins are external for target bun.
export const EXTERNALS = [
	"@earendil-works/*",
	"@mariozechner/*",
	"@oh-my-pi/*",
	"typebox",
	"typebox/*",
	"@sinclair/typebox",
	"@sinclair/typebox/*",
];

if (typeof Bun === "undefined") {
	console.error("build-bundle: run with bun (bun scripts/omp/build-bundle.mjs)");
	process.exit(1);
}

mkdirSync(resolve(root, "dist"), { recursive: true });
const result = await Bun.build({
	entrypoints: [resolve(root, "extensions/index.ts")],
	outdir: resolve(root, "dist"),
	naming: "omp-antigravity-bridge.js",
	format: "esm",
	target: "bun",
	minify: false,
	sourcemap: "none",
	external: EXTERNALS,
});
if (!result.success) {
	for (const log of result.logs) console.error(String(log));
	process.exit(1);
}
const out = resolve(root, BUNDLE_PATH);
console.log(`bundled ${BUNDLE_PATH} (${Math.round(statSync(out).size / 1024)} KiB)`);
