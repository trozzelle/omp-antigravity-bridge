#!/usr/bin/env node
// Owns the fork's package.json. Upstream bumps package.json on every release,
// so the sync flow takes upstream's file and re-runs this transform instead of
// hand-merging. Idempotent: running it on its own output changes nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FORK = "omp-antigravity-bridge";
const REPO = "https://github.com/trozzelle/omp-antigravity-bridge";
const DESCRIPTION_PREFIX = "OMP port of @estebanforge/pi-antigravity-bridge. ";

const SCRIPTS = {
	typecheck: "tsc --noEmit",
	test: "vitest run",
	"test:bun": "bunx --bun vitest run",
	"smoke:omp": "bash scripts/omp/smoke-load.sh",
};

const DEV_DEPENDENCIES = {
	"@earendil-works/pi-ai": "^1.6.0",
	"@earendil-works/pi-coding-agent": "^1.6.0",
	"@earendil-works/pi-tui": "^1.6.0",
	"@types/node": "^22.0.0",
	tsx: "^4.19.0",
	typebox: "^1.3.4",
	typescript: "^5.8.0",
	vitest: "^4.1.9",
	yaml: "^2.9.0",
};

const EXTRA_KEYWORDS = ["omp", "oh-my-pi"];

/** @param {Record<string, unknown>} pkg */
export function applyOverrides(pkg) {
	const upstreamVersion = String(pkg.version ?? "0.0.0").replace(/-omp(\.\d+)?$/, "");
	const upstreamDescription = String(pkg.description ?? "").replace(DESCRIPTION_PREFIX, "");
	const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : [];
	const files = Array.isArray(pkg.files) ? pkg.files.map(String) : [];
	const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
	const devDependencies = pkg.devDependencies && typeof pkg.devDependencies === "object" ? pkg.devDependencies : {};

	const out = { ...pkg };
	out.name = FORK;
	out.version = `${upstreamVersion}-omp`;
	out.description = `${DESCRIPTION_PREFIX}${upstreamDescription}`;
	out.private = true;
	delete out.publishConfig;
	out.keywords = [...keywords, ...EXTRA_KEYWORDS.filter((k) => !keywords.includes(k))];
	out.repository = { type: "git", url: `git+${REPO}.git` };
	out.homepage = `${REPO}#readme`;
	out.bugs = { url: `${REPO}/issues` };
	out.files = files.includes("CHANGELOG-OMP.md") ? files : [...files, "CHANGELOG-OMP.md"];
	out.omp = { extensions: ["./extensions/index.ts"] };
	out.scripts = { ...scripts, ...SCRIPTS };
	out.devDependencies = { ...devDependencies, ...DEV_DEPENDENCIES };
	return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const path = new URL("../../package.json", import.meta.url);
	const pkg = JSON.parse(readFileSync(path, "utf8"));
	writeFileSync(path, `${JSON.stringify(applyOverrides(pkg), null, 2)}\n`);
}
