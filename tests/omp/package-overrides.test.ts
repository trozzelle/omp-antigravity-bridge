import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../scripts/omp/apply-package-overrides.mjs";

const upstream = {
	name: "@estebanforge/pi-antigravity-bridge",
	version: "1.14.0",
	description: "Gemini provider for Pi.",
	keywords: ["pi-package", "agy"],
	license: "MIT",
	repository: { type: "git", url: "git+https://github.com/EstebanForge/pi-extensions.git", directory: "packages/pi-antigravity-bridge" },
	publishConfig: { access: "public" },
	type: "module",
	files: ["extensions", "src", "README.md", "CHANGELOG.md", "LICENSE"],
	pi: { extensions: ["./extensions"] },
	peerDependencies: { "@earendil-works/pi-coding-agent": "^1.5.1" },
	dependencies: { "@modelcontextprotocol/sdk": "^1.31.0" },
};

describe("applyOverrides", () => {
	it("rebrands an upstream package.json for the fork without dropping upstream fields", () => {
		const out = applyOverrides(structuredClone(upstream));
		expect(out.name).toBe("omp-antigravity-bridge");
		expect(out.version).toBe("1.14.0-omp");
		expect(out.private).toBe(true);
		expect(out.publishConfig).toBeUndefined();
		expect(out.repository).toEqual({ type: "git", url: "git+https://github.com/trozzelle/omp-antigravity-bridge.git" });
		expect(out.omp).toEqual({ extensions: ["./extensions/index.ts"] });
		expect(out.pi).toEqual({ extensions: ["./extensions"] });
		expect(out.dependencies).toEqual(upstream.dependencies);
		expect(out.peerDependencies).toEqual(upstream.peerDependencies);
		expect(out.files).toContain("CHANGELOG-OMP.md");
		expect(out.keywords).toEqual(expect.arrayContaining(["pi-package", "agy", "omp", "oh-my-pi"]));
		expect(out.scripts).toMatchObject({ typecheck: "tsc --noEmit", test: "vitest run", "smoke:omp": "bash scripts/omp/smoke-load.sh" });
		expect(out.devDependencies).toMatchObject({ vitest: "^4.1.9", "@earendil-works/pi-coding-agent": "^1.6.0" });
		expect(String(out.description)).toMatch(/^OMP port of @estebanforge\/pi-antigravity-bridge\. Gemini provider for Pi\.$/);
	});

	it("is idempotent, so re-running after an upstream merge changes nothing", () => {
		const once = applyOverrides(structuredClone(upstream));
		const twice = applyOverrides(structuredClone(once));
		expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
	});

	it("tracks a new upstream version when re-applied to an already-rebranded file", () => {
		const forked = applyOverrides(structuredClone(upstream));
		const bumped = applyOverrides({ ...forked, version: "1.15.0" });
		expect(bumped.version).toBe("1.15.0-omp");
	});
});
