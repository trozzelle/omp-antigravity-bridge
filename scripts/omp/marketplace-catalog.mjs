#!/usr/bin/env node
// Generates the OMP marketplace catalog (marketplace.json) for one release.
//
// The catalog is a release asset, not a file in the repository: each release
// publishes its own copy, and `releases/latest/download/marketplace.json`
// always serves the newest one. `omp plugin upgrade` compares the entry's
// `version` against the installed one, so it must be valid semver and grow
// with every release; the release tag minus its leading `v` does
// (1.13.1-omp.9 < 1.13.1-omp.10 < 1.14.0-omp.1).
//
// CLI: node scripts/omp/marketplace-catalog.mjs --version <v|tag> --ref <git ref> --sha <commit> [--out marketplace.json]
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const MARKETPLACE_NAME = "trozzelle";
export const PLUGIN_NAME = "omp-antigravity-bridge";
export const REPO = "trozzelle/omp-antigravity-bridge";

/** @param {{ version: string, ref: string, sha: string }} release */
export function buildCatalog({ version, ref, sha }) {
	const bare = version.replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(bare)) throw new Error(`not a semver version: ${version}`);
	if (!ref) throw new Error("ref is required");
	if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`sha must be a full 40-hex commit id: ${sha}`);
	return {
		name: MARKETPLACE_NAME,
		owner: { name: "trozzelle" },
		metadata: { description: "OMP plugins by trozzelle" },
		plugins: [
			{
				name: PLUGIN_NAME,
				description:
					"Gemini models through the Antigravity CLI (agy) for OMP, plus the AskAntigravity delegation tool. OMP port of @estebanforge/pi-antigravity-bridge.",
				version: bare,
				source: { source: "github", repo: REPO, ref, sha },
				homepage: `https://github.com/${REPO}/blob/main/docs/OMP.md`,
				license: "MIT",
				category: "development",
			},
		],
	};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
	const { values } = parseArgs({
		options: {
			version: { type: "string" },
			ref: { type: "string" },
			sha: { type: "string" },
			out: { type: "string", default: "marketplace.json" },
		},
	});
	if (!values.version || !values.ref || !values.sha) {
		console.error("usage: marketplace-catalog.mjs --version <version> --ref <ref> --sha <sha> [--out marketplace.json]");
		process.exit(2);
	}
	writeFileSync(values.out, `${JSON.stringify(buildCatalog({ version: values.version, ref: values.ref, sha: values.sha }), null, 2)}\n`);
}
