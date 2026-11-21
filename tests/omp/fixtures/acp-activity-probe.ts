// Runs under the Bun runtime with Bun's own transpiler (the way OMP loads the
// extension). Drives one ACP tool_start and one tool_done through
// consumeActivity and prints what reached onNativeEvent as one JSON line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { TurnDiffContext } from "../../../src/diff-render.js";
import { consumeActivity, type BlockState, type NativeDisplayEvent } from "../../../src/provider.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-activity-probe-"));
const file = path.join(dir, "note.txt");
fs.writeFileSync(file, "hello\n");

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
const blocks: BlockState = { partial, textIdx: null, thinkingIdx: null, started: false };
const stream = createAssistantMessageEventStream();
const diffCtx = new TurnDiffContext({ toplevel: () => null, showHead: () => null });
const events: NativeDisplayEvent[] = [];
const errors: string[] = [];
const feats = { engine: "acp" as const, onNativeEvent: (e: NativeDisplayEvent) => void events.push(e) };

for (const activity of [
	{ type: "tool_start" as const, name: "write_file", args: { file_path: file, callId: "call-1" } },
	{ type: "tool_done" as const, name: "write_file", args: { file_path: file, callId: "call-1" } },
]) {
	try {
		consumeActivity(stream, blocks, activity, diffCtx, dir, feats);
	} catch (err) {
		errors.push(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
	}
}
fs.rmSync(dir, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ events, errors })}\n`);
