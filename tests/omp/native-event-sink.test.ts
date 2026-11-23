// NativeEventSink: text a sink returns for an ACP native step lands in the
// reply's thinking at the step's position. Host-independent.
//
// Run: npx vitest run tests/omp/native-event-sink.test.ts

import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { TurnDiffContext } from "../../src/diff-render.js";
import { consumeActivity, type BlockState, type NativeEventSink } from "../../src/provider.js";

function newBlocks(): BlockState {
	const partial: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "agy-bridge",
		provider: "antigravity",
		model: "gemini-flash",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
	return { partial, textIdx: null, thinkingIdx: null, started: false };
}

function runner(sink: NativeEventSink) {
	const blocks = newBlocks();
	const stream = createAssistantMessageEventStream();
	const diffCtx = new TurnDiffContext({ toplevel: () => null, showHead: () => null });
	const run = (activity: Parameters<typeof consumeActivity>[2]) => consumeActivity(stream, blocks, activity, diffCtx, "/w", { engine: "acp", onNativeEvent: sink });
	return { blocks, run };
}

const label = (event: Parameters<NativeEventSink>[0]): string => `${event.status} ${event.name}`;

describe("native event sink", () => {
	test("text returned for a completed step lands between the text around it, not after the reply", () => {
		const { blocks, run } = runner((event) => (event.status === "started" ? undefined : `${label(event)} ${event.command ?? ""}`));
		assert.equal(run({ type: "text", delta: "Checking the tree." }), "continue");
		assert.equal(run({ type: "tool_start", name: "run_command", args: { CommandLine: "ls -la" } }), "continue");
		assert.equal(run({ type: "tool_done", name: "run_command", args: { CommandLine: "ls -la" }, output: "total 0" }), "continue");
		assert.equal(run({ type: "text", delta: "Which option?" }), "continue");

		const content = blocks.partial.content;
		assert.deepEqual(
			content.map((b) => b.type),
			["text", "thinking", "text"],
		);
		const [, thinking, last] = content;
		assert.ok(thinking.type === "thinking" && thinking.thinking === "completed run_command ls -la", JSON.stringify(thinking));
		assert.ok(last.type === "text" && last.text === "Which option?");
		assert.equal(blocks.partial.stopReason, "stop");
	});

	test("text returned for started and failed steps lands too", () => {
		const { blocks, run } = runner(label);
		run({ type: "tool_start", name: "read_file", args: {} });
		run({ type: "tool_error", name: "read_file", message: "ENOENT" });
		const [thinking] = blocks.partial.content;
		assert.ok(thinking?.type === "thinking" && thinking.thinking === "started read_filefailed read_file", JSON.stringify(thinking));
	});

	test("a sink returning nothing adds nothing, with no fallback label", () => {
		const { blocks, run } = runner(() => undefined);
		run({ type: "tool_start", name: "read_file", args: {} });
		run({ type: "tool_done", name: "read_file", args: {}, output: "x" });
		run({ type: "tool_error", name: "read_file", message: "ENOENT" });
		assert.deepEqual(blocks.partial.content, []);
	});
});
