#!/usr/bin/env node
// package.json for the marketplace bundle layout: the same manifest with
// `omp.extensions` pointing at the prebuilt bundle. Marketplace installs never
// run npm install, so the bundle must carry every runtime dependency itself.
//
// CLI: node scripts/omp/bundle-manifest.mjs <source-package.json> <dest-package.json>
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BUNDLE_ENTRY = "./dist/omp-antigravity-bridge.js";

/** @param {Record<string, unknown>} pkg */
export function bundleManifest(pkg) {
	return { ...pkg, omp: { ...(pkg.omp && typeof pkg.omp === "object" ? pkg.omp : {}), extensions: [BUNDLE_ENTRY] } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	const [src, dest] = process.argv.slice(2);
	if (!src || !dest) {
		console.error("usage: bundle-manifest.mjs <source-package.json> <dest-package.json>");
		process.exit(2);
	}
	writeFileSync(dest, `${JSON.stringify(bundleManifest(JSON.parse(readFileSync(src, "utf8"))), null, 2)}\n`);
}
