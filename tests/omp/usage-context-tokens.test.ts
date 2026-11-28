// OMP reads `usage.contextTokens ?? input + cacheRead + cacheWrite` for
// auto-compaction (~85% of the window) and its overflow check. agy's input and
// cacheRead are multi-inference billing sums, and upstream's clamp only
// rescales past 100% of the window, so inkling2 2026-11-25 compacted at a
// recorded 963,237 tokens (203,113 + 760,124) on a 205,617 corrected total.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, test } from "vitest";
import { normalizeContext, type Api, type AssistantMessage, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { ToolRoundTrips, createStreamSimple } from "../../src/provider.js";
import { SessionStore } from "../../src/sessions.js";
import { clampOverflowUsage } from "../../src/stream-events.js";
import { stampContextTokens } from "../../src/omp/usage.js";
import type { StreamDriver, DriverTurnRequest } from "../../src/driver.js";
import type { DriverActivity, TurnHandle, TurnOutcome } from "../../src/driver-types.js";

const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
const fakeAgentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ctx-tokens-home-"));
process.env.PI_CODING_AGENT_DIR = path.join(fakeAgentRoot, ".pi", "agent");
afterAll(() => {
	if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
	fs.rmSync(fakeAgentRoot, { recursive: true, force: true });
});

const model: Model<Api> = {
	id: "gemini-flash",
	name: "Gemini 3.8 Flash",
	api: "agy-bridge" as Api,
	provider: "antigravity",
	baseUrl: "agy-bridge://antigravity",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_048_576,
	maxTokens: 65_536,
};

function fakeDriver(activities: DriverActivity[], outcome: TurnOutcome): StreamDriver {
	return {
		get activeHandle() {
			return null;
		},
		kickIdle: () => {},
		reentry: () => null,
		snapshot: () => ({ state: "ready", conversationId: undefined, stats: {} }),
		run: async (_opts: DriverTurnRequest) => {
			const queue = [...activities];
			return {
				id: "fake-turn",
				outcome: Promise.resolve(outcome),
				next: async () => queue.shift() ?? null,
				pushExternal: () => {},
			} satisfies TurnHandle as unknown as TurnHandle;
		},
	} as unknown as StreamDriver;
}

describe("stampContextTokens", () => {
	test("pins the occupancy read to the corrected total between the compaction threshold and the window", () => {
		const usage: { input: number; output: number; cacheRead: number; totalTokens: number; contextTokens?: number } = {
			input: 203_113,
			output: 5_971,
			cacheRead: 760_124,
			totalTokens: 205_617,
		};
		clampOverflowUsage(usage, 1_048_576);
		stampContextTokens(usage);
		// The clamp leaves sums under the window alone; contextTokens carries the truth.
		assert.equal(usage.input + usage.cacheRead, 963_237);
		assert.equal(usage.contextTokens, 205_617);
	});

	test("leaves usage without a positive total unstamped", () => {
		for (const totalTokens of [0, -1, Number.NaN]) {
			const usage: { totalTokens: number; contextTokens?: number } = { totalTokens };
			stampContextTokens(usage);
			assert.equal(usage.contextTokens, undefined);
		}
	});

	test("the provider stamps contextTokens on finalized stop turns (ACP and stream-json)", async () => {
		for (const engine of ["acp", "stream-json"] as const) {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-ctx-tokens-"));
			try {
				const driver = fakeDriver(
					[
						{ type: "usage", usage: { input_tokens: 203_113, output_tokens: 5_971, cache_read_tokens: 760_124, total_tokens: 205_617 } },
						{ type: "text", delta: "done" },
					],
					{ status: "OK", response: "done", finished: true, aborted: false, conversationId: "conv-1", modelOutputSeen: true, sawResult: true },
				);
				const streamSimple = createStreamSimple({
					entries: [{ id: model.id, full: "gemini-3.8-flash" }],
					store: new SessionStore(path.join(dir, "sessions.json")),
					driver,
					...(engine === "acp" ? { acpDriver: driver, engine } : { engine }),
					roundTrips: new ToolRoundTrips(driver),
				});
				let message: AssistantMessage | undefined;
				for await (const ev of streamSimple(
					model,
					normalizeContext({ messages: [{ role: "user", content: "run tests", timestamp: 1000 }] }),
					{ cwd: dir, sessionId: "s-ctx" } as unknown as SimpleStreamOptions,
				)) {
					if (ev.type === "done") message = ev.message;
					if (ev.type === "error") assert.fail(`${engine}: unexpected error ${ev.error.errorMessage}`);
				}
				assert.ok(message, `${engine}: no terminal message`);
				assert.equal(message.usage.totalTokens, 205_617, engine);
				assert.equal((message.usage as { contextTokens?: number }).contextTokens, 205_617, engine);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		}
	});
});
