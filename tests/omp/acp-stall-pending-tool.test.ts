// inkling2 2026-11-25: agy blocks inside a foreground native tool (zig build,
// a sleep-and-check wait) and sends no session/update frames while it runs.
// The idle guard read that as a stall and killed agy mid-tool 9 times in one
// session. With a native tool call in flight the guard now defers, bounded by
// the pending-tool cap; a silent turn with no tool in flight still stalls.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "vitest";
import { AcpDriver } from "../../src/acp/driver.js";

const FAKE_SERVER = path.resolve(import.meta.dirname, "../helpers/fake-acp-server.mjs");
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanups.splice(0)) fn();
});

async function runSilent(scenario: string, pendingToolStallCapMs?: number) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-acp-stall-"));
	const events: string[] = [];
	const driver = new AcpDriver({
		bin: process.execPath,
		binArgs: [FAKE_SERVER],
		extraEnv: { ACP_FAKE_SCENARIO: scenario, ACP_FAKE_LOG: path.join(dir, "log.jsonl") },
		pendingToolStallCapMs,
		log: (msg) => events.push(msg),
	});
	cleanups.push(() => {
		void driver.close("shutdown");
		fs.rmSync(dir, { recursive: true, force: true });
	});
	const started = Date.now();
	const handle = await driver.run({
		cwd: dir,
		model: "gemini-3.8-flash",
		effort: "low",
		mode: "accept-edits",
		skipPermissions: true,
		prompt: "build",
		timeoutMin: 0,
		inactivityMin: 0.005, // 300ms idle window
		signal: new AbortController().signal,
	});
	void (async () => {
		while ((await handle.next()) !== null) {
			// drain
		}
	})();
	const outcome = await handle.outcome;
	return { outcome, elapsed: Date.now() - started, events };
}

describe("ACP idle stall with a native tool in flight", () => {
	test("a silent turn with no tool in flight still stalls on the idle window", async () => {
		const { outcome, elapsed, events } = await runSilent("slow", 1_500);
		assert.equal(outcome.status, "ERROR");
		assert.match(outcome.error ?? "", /stalled/);
		assert.ok(elapsed < 1_400, `stalled after ${elapsed}ms; the pending-tool cap must not apply`);
		assert.ok(!events.includes("stall-deferred"));
	}, 15_000);

	test("a pending native tool defers the stall up to the pending-tool cap", async () => {
		const { outcome, elapsed, events } = await runSilent("tool-hang", 1_500);
		assert.equal(outcome.status, "ERROR");
		assert.match(outcome.error ?? "", /stalled/);
		assert.ok(elapsed >= 1_400, `stall fired after ${elapsed}ms, before the pending-tool cap`);
		assert.ok(events.includes("stall-deferred"), "the deferral must be logged");
		assert.ok(events.includes("stall"));
	}, 15_000);
});
