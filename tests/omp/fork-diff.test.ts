import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/omp/fork-diff.sh against a tiny fork: an upstream branch, a main
// that merges it and changes upstream files, and fork-only files that must
// not count.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(repoRoot, "scripts/omp/fork-diff.sh");

const gitEnv: NodeJS.ProcessEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: os.devNull,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
delete gitEnv.GITHUB_STEP_SUMMARY;

let repo: string;

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: repo, env: gitEnv, encoding: "utf8" }).trim();
}

function write(rel: string, content: string): void {
	const file = path.join(repo, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function commitAll(message: string): void {
	git("add", "-A");
	git("commit", "-q", "-m", message);
}

function run(args: string[] = [], env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; out: Record<string, string> } {
	const r = spawnSync("bash", [SCRIPT, "--upstream", "upstream", ...args], { cwd: repo, env: { ...gitEnv, ...env }, encoding: "utf8" });
	const out: Record<string, string> = {};
	for (const line of r.stdout.split("\n")) {
		const m = /^(\w+)=(.*)$/.exec(line);
		if (m) out[m[1]] = m[2];
	}
	return { code: r.status ?? -1, stdout: r.stdout, out };
}

const lines = (n: number, tag = "line"): string => Array.from({ length: n }, (_, i) => `${tag} ${i}\n`).join("");

beforeEach(() => {
	repo = fs.mkdtempSync(path.join(os.tmpdir(), "fork-diff-"));
	git("init", "-q", "-b", "upstream");
	write("src/a.ts", lines(10));
	write("src/b.ts", lines(10));
	write("package.json", "{}\n");
	write("README.md", "upstream\n");
	commitAll("upstream 1");
	git("switch", "-q", "-c", "main");
	// Fork changes: 2 lines replaced in a.ts, 3 added to b.ts; fork-only
	// files and the two sync-resolved files never count.
	write("src/a.ts", lines(10).replace("line 1\n", "fork 1\n").replace("line 2\n", "fork 2\n"));
	write("src/b.ts", lines(10) + lines(3, "fork"));
	write("src/omp/new.ts", lines(50));
	write("package.json", '{"name":"fork"}\n');
	write("README.md", "fork readme\n");
	commitAll("fork");
});

afterEach(() => {
	fs.rmSync(repo, { recursive: true, force: true });
});

describe("fork-diff.sh", () => {
	it("counts only changes to upstream-owned files", () => {
		const r = run();
		expect(r.code).toBe(0);
		expect(r.out).toMatchObject({ files: "2", added: "5", removed: "2", total: "7" });
	});

	it("measures against the upstream version main merged, not the newest upstream", () => {
		// Upstream moves on (not merged yet): its new changes are not the fork's.
		git("switch", "-q", "upstream");
		write("src/a.ts", lines(10) + lines(20, "upstream"));
		commitAll("upstream 2");
		git("switch", "-q", "main");
		expect(run().out.total).toBe("7");
		// After the merge the fork's footprint is the same 7 lines.
		git("merge", "-q", "--no-edit", "upstream");
		expect(run().out.total).toBe("7");
	});

	it("reports the change from a base ref and warns when it grows", () => {
		git("switch", "-q", "-c", "feature");
		write("src/b.ts", lines(10) + lines(5, "fork"));
		commitAll("grow");
		const grown = run(["--base", "main"]);
		expect(grown.out).toMatchObject({ total: "9", base_total: "7", delta: "2" });
		expect(grown.stdout).toContain("::warning title=Fork footprint grew::");

		write("src/b.ts", lines(10));
		commitAll("shrink");
		const shrunk = run(["--base", "main"]);
		expect(shrunk.out).toMatchObject({ total: "4", delta: "-3" });
		expect(shrunk.stdout).not.toContain("::warning");
	});

	it("measures uncommitted edits with --worktree", () => {
		write("src/a.ts", lines(10));
		expect(run().out.total).toBe("7");
		expect(run(["--worktree"]).out.total).toBe("3");
	});

	it("writes a summary table under GitHub Actions", () => {
		const summary = path.join(repo, "..", `${path.basename(repo)}-summary.md`);
		try {
			run(["--base", "main"], { GITHUB_STEP_SUMMARY: summary });
			const text = fs.readFileSync(summary, "utf8");
			expect(text).toContain("2 files, +5 / -2 (7 lines)");
			expect(text).toContain("| 3 | 0 | `src/b.ts` |");
			expect(text).not.toContain("src/omp/new.ts");
		} finally {
			fs.rmSync(summary, { force: true });
		}
	});
});
