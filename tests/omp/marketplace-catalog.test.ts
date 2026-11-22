import { describe, expect, it } from "vitest";
import semver from "semver";
import { bundleManifest } from "../../scripts/omp/bundle-manifest.mjs";
import { buildCatalog } from "../../scripts/omp/marketplace-catalog.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("buildCatalog", () => {
	it("publishes one github-sourced plugin pinned to the bundle tag and commit", () => {
		const catalog = buildCatalog({ version: "v1.13.1-omp.4", ref: "v1.13.1-omp.4-bundle", sha: SHA });
		expect(catalog.name).toBe("trozzelle");
		expect(catalog.owner).toEqual({ name: "trozzelle" });
		expect(catalog.plugins).toHaveLength(1);
		expect(catalog.plugins[0]).toMatchObject({
			name: "omp-antigravity-bridge",
			version: "1.13.1-omp.4",
			source: { source: "github", repo: "trozzelle/omp-antigravity-bridge", ref: "v1.13.1-omp.4-bundle", sha: SHA },
			homepage: "https://github.com/trozzelle/omp-antigravity-bridge/blob/main/docs/OMP.md",
			license: "MIT",
			category: "development",
		});
	});

	it("accepts a version without the leading v", () => {
		expect(buildCatalog({ version: "1.14.0-omp.1", ref: "r", sha: SHA }).plugins[0].version).toBe("1.14.0-omp.1");
	});

	it("rejects malformed input", () => {
		expect(() => buildCatalog({ version: "latest", ref: "r", sha: SHA })).toThrow(/semver/);
		expect(() => buildCatalog({ version: "1.0.0-omp.1", ref: "r", sha: "abc" })).toThrow(/sha/);
		expect(() => buildCatalog({ version: "1.0.0-omp.1", ref: "", sha: SHA })).toThrow(/ref/);
	});

	it("makes every later release a semver upgrade over the earlier one", () => {
		const v = (version: string) => buildCatalog({ version: `v${version}`, ref: "r", sha: SHA }).plugins[0].version;
		expect(semver.valid(v("1.13.1-omp.4"))).toBeTruthy();
		expect(semver.gt(v("1.13.1-omp.10"), v("1.13.1-omp.9"))).toBe(true);
		expect(semver.gt(v("1.14.0-omp.1"), v("1.13.1-omp.9"))).toBe(true);
		expect(semver.gt(v("1.13.1-omp.5"), v("1.13.1-omp.4"))).toBe(true);
	});
});

describe("bundleManifest", () => {
	it("points omp.extensions at the bundle and keeps the rest of the manifest", () => {
		const pkg = { name: "omp-antigravity-bridge", version: "1.13.1-omp", dependencies: { diff: "^8.0.4" }, omp: { extensions: ["./extensions/index.ts"] } };
		expect(bundleManifest(pkg)).toEqual({ ...pkg, omp: { extensions: ["./dist/omp-antigravity-bridge.js"] } });
	});
});
