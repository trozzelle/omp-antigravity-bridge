// A provider call whose signal is already aborted is a deliberate abort, not a
// start failure: OMP aborts auxiliary calls routinely, and the README promises
// that deliberate aborts stay silent (nothing on disk, no toast). Genuine
// driver start failures keep their error-level log.
// Run: npm test

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { normalizeContext, type Api, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ToolRoundTrips, createStreamSimple } from "../src/provider.js";
import { SessionStore } from "../src/sessions.js";
import type { DriverTurnRequest, StreamDriver } from "../src/driver.js";

const model: Model<Api> = {
	id: "gemini-flash",
	name: "Gemini 3.6 Flash (Medium)",
	api: "agy-bridge" as Api,
	provider: "antigravity",
	baseUrl: "agy-bridge://antigravity",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 65_536,
};

interface LogRow {
	event: string;
	data: unknown;
	level?: string;
}

// Mirrors both real drivers: they reject a request whose signal is already aborted.
const startRejecting = (failure: () => Error): StreamDriver =>
	({
		run: async (request: DriverTurnRequest) => {
			if (request.signal?.aborted) throw new Error("aborted before start");
			throw failure();
		},
	}) as unknown as StreamDriver;

async function callWith(driver: StreamDriver, signal: AbortSignal | undefined) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-start-abort-"));
	const logs: LogRow[] = [];
	const streamSimple = createStreamSimple({
		entries: [{ id: "gemini-flash", full: "gemini-3.6-flash" }],
		store: new SessionStore(path.join(dir, "sessions.json")),
		driver,
		roundTrips: new ToolRoundTrips(driver),
		log: (event, data, level) => logs.push({ event, data, level }),
	});
	const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] });
	const stream = streamSimple(model, context, { cwd: dir, signal } as unknown as SimpleStreamOptions);
	let terminal: { stopReason?: string; errorMessage?: string } = {};
	for await (const ev of stream) {
		if (ev.type === "error") terminal = ev.error;
		if (ev.type === "done") terminal = ev.message;
	}
	fs.rmSync(dir, { recursive: true, force: true });
	return { terminal, logs };
}

test("a pre-aborted signal ends the call as aborted without an error-level log", async () => {
	const controller = new AbortController();
	controller.abort();
	const { terminal, logs } = await callWith(startRejecting(() => new Error("unreachable")), controller.signal);
	assert.equal(terminal.stopReason, "aborted");
	assert.equal(terminal.errorMessage, "Operation aborted");
	assert.deepEqual(logs.filter((l) => l.level === "error"), []);
	const startLog = logs.find((l) => l.event === "turn-error");
	assert.ok(startLog);
	assert.equal(startLog.level, "debug");
});

test("a genuine driver start failure still logs at error level and ends as error", async () => {
	const { terminal, logs } = await callWith(startRejecting(() => new Error("spawn agy ENOENT")), new AbortController().signal);
	assert.equal(terminal.stopReason, "error");
	assert.match(terminal.errorMessage ?? "", /agy failed to start: spawn agy ENOENT/);
	assert.equal(logs.find((l) => l.event === "turn-error")?.level, "error");
});
