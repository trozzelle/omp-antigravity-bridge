// Probe extension for scripts/omp/smoke-live.sh. Load it next to the bridge:
//   omp --no-extensions -e . -e scripts/omp/probe-extension.ts ...
// It is not part of the published package ("files" ships extensions/ and src/).
//
// Registers:
//   - echo_probe {text}: returns "ECHO_MARKER_7Q3 <text>" (bridge round-trip).
//     Registered by the first factory call only (the main session): OMP re-runs
//     every factory per subagent in the same module realm, so a parent turn
//     wrongly served through a subagent's tool catalog cannot see echo_probe.
//   - slow_probe {}: sleeps OMP_PROBE_SLOW_MS (default 26 s, past the bridge's
//     20 s escalation) and returns "SLOW_MARKER_9W2" (long-call poll)
//   - /probe-model <provider>/<id>: switches the session model; print mode
//     runs extension commands without a model turn
//   - provider probe/scripted: a scripted parent model that spawns one
//     subagent with the `task` tool, waits for it, and logs what it saw
// Every event is appended as one JSON line to $OMP_PROBE_LOG (unset: no log).
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const LOG_PATH = process.env.OMP_PROBE_LOG;
const SLOW_MS = Number(process.env.OMP_PROBE_SLOW_MS ?? 26_000);
const CHILD_TASK = "Reply with exactly: CHILD_OK";

function log(event: string, data: Record<string, unknown>): void {
	if (!LOG_PATH) return;
	fs.appendFileSync(LOG_PATH, `${JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, event, ...data })}\n`);
}

function messageText(message: Message): string {
	const content: unknown = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n");
}

function hasToolCall(message: Message, name: string): boolean {
	return message.role === "assistant" && message.content.some((b) => b.type === "toolCall" && b.name === name);
}

/** Next step of the scripted parent: spawn the child, wait for its result, then report. */
function scriptedStep(messages: readonly Message[]): { call?: Omit<ToolCall, "type">; text?: string } {
	if (!messages.some((m) => hasToolCall(m, "task"))) {
		return {
			call: {
				id: `probe-task-${Date.now()}`,
				name: "task",
				arguments: {
					context: "Live smoke check of a subagent turn.",
					tasks: [{ task: CHILD_TASK, solutionSpace: "one fixed reply" }],
				},
			},
		};
	}
	const results = messages.filter((m) => m.role === "toolResult").map(messageText);
	// The child's final message arrives inside <task-result …><output>…</output>.
	const childOutput = results
		.map((t) => /<task-result[^>]*>[\s\S]*?<output>\n?([\s\S]*?)\n?<\/output>/.exec(t)?.[1])
		.find((o) => o !== undefined);
	const nothingLeft = results.some((t) => t.startsWith("Nothing to wait for"));
	const waits = messages.filter((m) => hasToolCall(m, "wait")).length;
	if (childOutput === undefined && !nothingLeft && waits < 5) {
		return { call: { id: `probe-wait-${Date.now()}`, name: "wait", arguments: {} } };
	}
	log("scripted.done", { childOutput: childOutput ?? null });
	return { text: `PARENT_SAW ${childOutput ?? "<no child result>"}` };
}

function scriptedStream(model: Model<Api>, context: TranscriptContext) {
	const stream = createAssistantMessageEventStream();
	const messages = context.messages;
	const spawnRun = messages.some((m) => m.role === "user" && messageText(m).includes("SPAWN_CHILD"));
	const step = spawnRun ? scriptedStep(messages) : { text: "SCRIPTED_DEFAULT" };
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: step.call ? "toolUse" : "stop",
		timestamp: Date.now(),
	};
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		if (step.call) {
			const toolCall: ToolCall = { type: "toolCall", ...step.call };
			message.content.push(toolCall);
			stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
			stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
			stream.push({ type: "done", reason: "toolUse", message });
		} else {
			const text = step.text ?? "";
			message.content.push({ type: "text", text });
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
			stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
			stream.push({ type: "done", reason: "stop", message });
		}
		stream.end();
	});
	return stream;
}

// OMP shares module state across the main session and its subagents.
let factoryCalls = 0;

export default function probeExtension(pi: ExtensionAPI): void {
	factoryCalls += 1;
	if (factoryCalls === 1) registerEchoProbe(pi);

	pi.registerTool({
		name: "slow_probe",
		label: "Slow Probe",
		description: "Diagnostic tool that takes about 26 seconds and returns a marker. No arguments.",
		parameters: Type.Object({}),
		execute: async (toolCallId) => {
			log("slow_probe.start", { toolCallId });
			await sleep(SLOW_MS);
			log("slow_probe.end", { toolCallId });
			return { content: [{ type: "text", text: "SLOW_MARKER_9W2" }], details: {} };
		},
	});

	pi.registerCommand("probe-model", {
		description: "Switch the session model: /probe-model <provider>/<id>",
		handler: async (args, ctx) => {
			const selector = args.trim();
			const slash = selector.indexOf("/");
			const model = slash > 0 ? ctx.modelRegistry.find(selector.slice(0, slash), selector.slice(slash + 1)) : undefined;
			const ok = model ? await pi.setModel(model) : false;
			log("probe-model", { selector, ok });
		},
	});

	pi.on("tool_execution_end", (event) => {
		log("tool_execution_end", { toolCallId: event.toolCallId, toolName: event.toolName, isError: event.isError });
	});

	pi.registerProvider("probe", {
		name: "Probe",
		baseUrl: "probe://scripted",
		apiKey: "not-used",
		api: "probe-scripted",
		models: [
			{
				id: "scripted",
				name: "Scripted probe",
				api: "probe-scripted",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000,
				maxTokens: 4096,
			},
		],
		streamSimple: scriptedStream,
	});
}

function registerEchoProbe(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "echo_probe",
		label: "Echo Probe",
		description: "Diagnostic tool. Returns a marker string followed by the given text. Call it when asked to run echo_probe.",
		parameters: Type.Object({ text: Type.String({ description: "Text to echo back." }) }),
		execute: async (toolCallId, params) => {
			log("echo_probe.execute", { toolCallId, text: params.text });
			return { content: [{ type: "text", text: `ECHO_MARKER_7Q3 ${params.text}` }], details: {} };
		},
	});
}
