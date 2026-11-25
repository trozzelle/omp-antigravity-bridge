import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOverrides } from "../../scripts/omp/apply-package-overrides.mjs";

// Fixture-driven tests for scripts/omp/sync-upstream.sh: a tiny upstream
// monorepo, a fork built from its subtree split plus two patch commits, and
// the real sync and package-override scripts.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SYNC_SCRIPT = path.join(repoRoot, "scripts/omp/sync-upstream.sh");
const OVERRIDES_SCRIPT = path.join(repoRoot, "scripts/omp/apply-package-overrides.mjs");
const PREFIX = "packages/pi-antigravity-bridge";

// Hermetic git: no user/system config (signing, hooks, default branch), fixed identity.
const gitEnv: NodeJS.ProcessEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: os.devNull,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.invalid",
	GIT_COMMITTER_NAME: "Fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};
delete gitEnv.GITHUB_OUTPUT;

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(file: string, content: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function upstreamPackageJson(version: string, extraDeps: Record<string, string> = {}): string {
	const pkg = {
		name: "@estebanforge/pi-antigravity-bridge",
		version,
		license: "MIT",
		type: "module",
		files: ["extensions", "src", "README.md", "CHANGELOG.md", "LICENSE"],
		pi: { extensions: ["./extensions"] },
		peerDependencies: { "@earendil-works/pi-coding-agent": "^1.5.1" },
		peerDependenciesMeta: { "@earendil-works/pi-coding-agent": { optional: true } },
		dependencies: {
			"@estebanforge/pi-ask-shared": "^0.1.6",
			"@estebanforge/pi-tui-dialogs": "^0.1.3",
			"@modelcontextprotocol/sdk": "^1.31.0",
			...extraDeps,
		},
	};
	return `${JSON.stringify(pkg, null, 2)}\n`;
}

function changelog(versions: string[]): string {
	const sections = versions.map((v, i) => `## [${v}] - 2026-11-0${i + 1}\n\n- change in ${v}\n`);
	return `# Changelog\n\n${sections.join("\n")}`;
}

interface SyncRun {
	code: number;
	stdout: string;
	stderr: string;
	out: Record<string, string>;
}

let tmp: string;
let mono: string;
let fork: string;

function runSync(env: NodeJS.ProcessEnv = {}): SyncRun {
	const r = spawnSync("bash", [SYNC_SCRIPT], {
		cwd: fork,
		env: { ...gitEnv, UPSTREAM_REPO_DIR: mono, SYNC_OUT_DIR: path.join(tmp, "out"), ...env },
		encoding: "utf8",
	});
	const out: Record<string, string> = {};
	for (const line of r.stdout.split("\n")) {
		const eq = line.indexOf("=");
		if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
	}
	return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, out };
}

function splitOf(repo: string): string {
	return git(repo, "subtree", "split", `--prefix=${PREFIX}`, "main");
}

function commitUpstream(message: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) write(path.join(mono, PREFIX, rel), content);
	git(mono, "add", "-A");
	git(mono, "commit", "-q", "-m", message);
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sync-test-"));
	mono = path.join(tmp, "mono");
	fork = path.join(tmp, "fork");

	// Upstream monorepo: the bridge package plus an unrelated sibling package.
	fs.mkdirSync(mono);
	git(mono, "init", "-q", "-b", "main");
	write(path.join(mono, "README.md"), "monorepo\n");
	write(path.join(mono, "packages/other/index.ts"), "export const other = 1;\n");
	commitUpstream("chore: initial bridge", {
		"package.json": upstreamPackageJson("1.0.0"),
		"CHANGELOG.md": changelog(["1.0.0"]),
		"src/a.ts": "export const greeting = 'hello';\nexport const answer = 42;\n",
		"README.md": "# bridge\n\nUpstream intro for pi.\n",
	});
	write(path.join(mono, "packages/other/index.ts"), "export const other = 2;\n");
	git(mono, "commit", "-q", "-am", "chore(other): unrelated change");

	// Fork: upstream = split, main = upstream + two patch commits.
	const split = splitOf(mono);
	fs.mkdirSync(fork);
	git(fork, "init", "-q", "-b", "main");
	git(mono, "update-ref", "refs/fixture/split", split);
	git(fork, "fetch", "-q", mono, "refs/fixture/split");
	git(fork, "reset", "-q", "--hard", split);
	git(fork, "branch", "upstream", split);
	write(path.join(fork, "scripts/omp/apply-package-overrides.mjs"), fs.readFileSync(OVERRIDES_SCRIPT, "utf8"));
	execFileSync("node", ["scripts/omp/apply-package-overrides.mjs"], { cwd: fork, env: gitEnv });
	write(path.join(fork, "CHANGELOG-OMP.md"), "# Changelog (OMP)\n\n## Unreleased\n");
	git(fork, "add", "-A");
	git(fork, "commit", "-q", "-m", "omp: packaging");
	write(path.join(fork, "src/a.ts"), "export const greeting = 'hello from omp';\nexport const answer = 42;\n");
	git(fork, "commit", "-q", "-am", "omp: patch greeting");
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

// Each case runs real git (clone, subtree split, merge): allow slow CI disks.
describe("sync-upstream.sh", { timeout: 30_000 }, () => {
	it("reports up-to-date and creates no branch when upstream has not moved", () => {
		const r = runSync();
		expect(r.code, r.stderr).toBe(0);
		expect(r.out.status).toBe("up-to-date");
		expect(git(fork, "branch", "--list", "sync/*")).toBe("");
		expect(git(fork, "rev-parse", "upstream")).toBe(splitOf(mono));
	});

	it("merges a new upstream commit into main without rewriting it", () => {
		commitUpstream("feat: add b", {
			"src/b.ts": "export const b = true;\n",
			"CHANGELOG.md": changelog(["1.1.0", "1.0.0"]),
		});
		const split = splitOf(mono);
		const short = split.slice(0, 7);

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(r.out).toMatchObject({ status: "synced", sha: short, branch: `sync/${short}`, upstream_sha: split });
		expect(git(fork, "rev-parse", "upstream")).toBe(split);
		const mainSha = git(fork, "rev-parse", "main");
		// A merge commit whose parents are main and upstream: main's history is kept.
		expect(git(fork, "rev-list", "--parents", "-n", "1", `sync/${short}`).split(" ").slice(1)).toEqual([mainSha, split]);
		expect(git(fork, "log", "-1", "--format=%s", `sync/${short}`)).toBe(`sync: merge upstream 1.0.0 (${short})`);
		expect(git(fork, "log", "--no-merges", "--format=%s", `upstream..sync/${short}`).split("\n")).toEqual([
			"omp: patch greeting",
			"omp: packaging",
		]);
		expect(git(fork, "show", `sync/${short}:src/a.ts`)).toContain("hello from omp");
		expect(git(fork, "show", `sync/${short}:src/b.ts`)).toContain("export const b");
		expect(git(fork, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
		const delta = fs.readFileSync(path.join(tmp, "out/changelog-delta.md"), "utf8");
		expect(delta).toContain("## [1.1.0]");
		expect(delta).not.toContain("## [1.0.0]");
	});

	it("resolves a package.json-only conflict by re-applying the overrides to upstream's file", () => {
		const bumped = upstreamPackageJson("1.1.0", { "left-pad": "^1.3.0" });
		commitUpstream("chore(release): 1.1.0", {
			"package.json": bumped,
			"CHANGELOG.md": changelog(["1.1.0", "1.0.0"]),
		});
		const short = splitOf(mono).slice(0, 7);

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(r.out.status).toBe("synced");
		expect(r.out.upstream_version).toBe("1.1.0");
		expect(r.out.base_version).toBe("1.0.0");
		expect(r.stderr).toContain("re-applying overrides");
		expect(JSON.parse(git(fork, "show", `sync/${short}:package.json`))).toEqual(applyOverrides(JSON.parse(bumped)));
		expect(git(fork, "log", "-1", "--format=%s", `sync/${short}`)).toBe(`sync: merge upstream 1.1.0 (${short})`);
	});

	it("normalizes package.json through the overrides after a merge with no package.json conflict", () => {
		// Upstream adds a dependency without touching the lines the overrides
		// rewrite, so git merges it cleanly; the result must still be exactly
		// the overrides applied to upstream's file.
		const pkg = JSON.parse(upstreamPackageJson("1.0.0", { "left-pad": "^1.3.0" }));
		commitUpstream("chore: add left-pad", { "package.json": upstreamPackageJson("1.0.0", { "left-pad": "^1.3.0" }) });
		const short = splitOf(mono).slice(0, 7);

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(JSON.parse(git(fork, "show", `sync/${short}:package.json`))).toEqual(applyOverrides(pkg));
		expect(git(fork, "status", "--porcelain")).toBe("");
	});

	it("keeps the fork's README when upstream edits its own", () => {
		const forkReadme = "# omp bridge\n\nThe fork's own README.\n";
		write(path.join(fork, "README.md"), forkReadme);
		git(fork, "commit", "-q", "-am", "omp: fork readme");
		commitUpstream("docs: expand readme", {
			"README.md": "# bridge\n\nUpstream intro for pi, now longer.\n",
		});
		const short = splitOf(mono).slice(0, 7);

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(r.out.status).toBe("synced");
		expect(r.stderr).toContain("keeping the fork's README");
		expect(git(fork, "show", `sync/${short}:README.md`)).toBe(forkReadme.trimEnd());
		expect(git(fork, "show", `upstream:README.md`)).toContain("now longer");
	});

	it("stops on any other conflict, names the fork commits behind it, and leaves the repo clean", () => {
		commitUpstream("fix: new greeting", {
			"src/a.ts": "export const greeting = 'hi';\nexport const answer = 42;\n",
		});

		const r = runSync();

		expect(r.code).toBe(3);
		expect(r.out.status).toBe("conflict");
		expect(r.out.fork_commits).toMatch(/^[0-9a-f]{7,} omp: patch greeting$/);
		expect(r.out.conflict_files).toBe("src/a.ts");
		expect(r.stderr).toContain("CONFLICT merging");
		expect(git(fork, "branch", "--list", "sync/*")).toBe("");
		expect(git(fork, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
		expect(git(fork, "status", "--porcelain")).toBe("");
		expect(fs.existsSync(path.join(fork, ".git/MERGE_HEAD"))).toBe(false);
	});

	it("keeps main's history across consecutive syncs: the second merge builds on the first", () => {
		commitUpstream("feat: add b", { "src/b.ts": "export const b = true;\n" });
		const first = runSync();
		expect(first.code, first.stderr).toBe(0);
		// The sync pull request is merged with a merge commit: main advances to the branch.
		git(fork, "merge", "-q", "--ff-only", first.out.branch);
		commitUpstream("feat: add c", { "src/c.ts": "export const c = true;\n" });

		const second = runSync();

		expect(second.code, second.stderr).toBe(0);
		expect(second.out.status).toBe("synced");
		expect(second.out.base_sha).toBe(first.out.upstream_sha);
		expect(git(fork, "merge-base", "--is-ancestor", first.out.branch, second.out.branch)).toBe("");
		expect(git(fork, "show", `${second.out.branch}:src/c.ts`)).toContain("export const c");
	});

	it("refuses to sync when main no longer contains upstream (a squash-merged sync)", () => {
		commitUpstream("feat: add b", { "src/b.ts": "export const b = true;\n" });
		const first = runSync();
		expect(first.code, first.stderr).toBe(0);
		// Squash the sync into main: same tree, but upstream is not an ancestor.
		git(fork, "merge", "-q", "--squash", first.out.branch);
		git(fork, "commit", "-q", "-m", "sync (squashed)");

		const r = runSync();

		expect(r.code).toBe(1);
		expect(r.stderr).toContain("main does not contain upstream");
	});

	it("refuses an upstream whose history was rewritten", () => {
		// Replace the bridge's history: drop the newest commit and amend the root.
		git(mono, "reset", "-q", "--hard", "HEAD~1");
		write(path.join(mono, PREFIX, "src/a.ts"), "export const rewritten = 1;\n");
		git(mono, "commit", "-q", "-a", "--amend", "-m", "chore: rewritten bridge");

		const r = runSync();

		expect(r.code).toBe(1);
		expect(r.stderr).toContain("upstream history was rewritten");
		expect(git(fork, "branch", "--list", "sync/*")).toBe("");
	});

	it("refuses a shallow upstream clone, whose split would not reproduce upstream", () => {
		const shallow = path.join(tmp, "shallow");
		git(tmp, "clone", "-q", "--depth", "1", `file://${mono}`, shallow);

		const r = runSync({ UPSTREAM_REPO_DIR: shallow });

		expect(r.code).toBe(1);
		expect(r.stderr).toContain("shallow clone");
	});

	it("reports pending with everything a pull request needs when the sync branch already exists on the remote", () => {
		commitUpstream("feat: add b", {
			"src/b.ts": "export const b = true;\n",
			"package.json": upstreamPackageJson("1.1.0"),
			"CHANGELOG.md": changelog(["1.1.0", "1.0.0"]),
		});
		const split = splitOf(mono);
		const short = split.slice(0, 7);
		// A hand-resolved sync branch the maintainer pushed: it exists on the remote only.
		git(fork, "update-ref", `refs/remotes/origin/sync/${short}`, git(fork, "rev-parse", "main"));
		const mainSha = git(fork, "rev-parse", "main");

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(r.out).toMatchObject({
			status: "pending",
			sha: short,
			branch: `sync/${short}`,
			upstream_sha: split,
			main_sha: mainSha,
			upstream_version: "1.1.0",
			base_version: "1.0.0",
		});
		expect(fs.readFileSync(path.join(tmp, "out/changelog-delta.md"), "utf8")).toContain("## [1.1.0]");
		expect(git(fork, "branch", "--list", "sync/*")).toBe("");
		expect(git(fork, "rev-parse", "upstream")).toBe(split);
	});

	it("reports pending when upstream was pushed ahead of main together with a hand-resolved sync branch", () => {
		commitUpstream("feat: add b", {
			"src/b.ts": "export const b = true;\n",
			"package.json": upstreamPackageJson("1.1.0"),
			"CHANGELOG.md": changelog(["1.1.0", "1.0.0"]),
		});
		const split = splitOf(mono);
		const short = split.slice(0, 7);
		const base = git(fork, "rev-parse", "upstream");
		// The maintainer resolved a conflict by hand and pushed both branches:
		// upstream is already at the split and main does not contain it yet.
		git(mono, "update-ref", "refs/fixture/split", split);
		git(fork, "fetch", "-q", mono, "refs/fixture/split");
		git(fork, "update-ref", "refs/heads/upstream", split);
		git(fork, "update-ref", `refs/remotes/origin/sync/${short}`, git(fork, "rev-parse", "main"));

		const r = runSync();

		expect(r.code, r.stderr).toBe(0);
		expect(r.out).toMatchObject({
			status: "pending",
			branch: `sync/${short}`,
			upstream_sha: split,
			upstream_version: "1.1.0",
			base_sha: base,
			base_version: "1.0.0",
		});
		expect(fs.readFileSync(path.join(tmp, "out/changelog-delta.md"), "utf8")).toContain("## [1.1.0]");
	});

	it("still refuses when upstream is ahead of main and no sync branch is pending", () => {
		commitUpstream("feat: add b", { "src/b.ts": "export const b = true;\n" });
		const split = splitOf(mono);
		git(mono, "update-ref", "refs/fixture/split", split);
		git(fork, "fetch", "-q", mono, "refs/fixture/split");
		git(fork, "update-ref", "refs/heads/upstream", split);

		const r = runSync();

		expect(r.code).toBe(1);
		expect(r.stderr).toContain("main does not contain upstream");
	});
});
