// OMP runs this extension on Bun, whose transpiler rewrites a function
// declaration placed inside a switch body into a case-local `let`, so later
// cases hit a TDZ ReferenceError. Vitest transforms modules with Vite (also
// under `bunx --bun`), which hides that class of bug, so this test runs a
// probe script through Bun's own loader.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const probe = fileURLToPath(new URL("./fixtures/acp-activity-probe.ts", import.meta.url));

function findBun(): string | undefined {
	if (process.versions.bun) return process.execPath;
	return spawnSync("bun", ["--version"]).status === 0 ? "bun" : undefined;
}
const bun = findBun();

describe.skipIf(bun === undefined)("ACP activity path under the Bun loader", () => {
	it("emits started and completed native events for an ACP edit tool", () => {
		const out = execFileSync(bun ?? "bun", [probe], { cwd: repoRoot, encoding: "utf8" });
		const result: unknown = JSON.parse(out.trim().split("\n").at(-1) ?? "{}");
		expect(result).toMatchObject({
			errors: [],
			events: [
				{ name: "write_file", status: "started", callId: "call-1" },
				{ name: "write_file", status: "completed", callId: "call-1", path: expect.stringMatching(/note\.txt$/) },
			],
		});
	});
});
