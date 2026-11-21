// OMP-shaped provider inputs, modelled on what OMP 19.1 hands an extension
// provider's streamSimple: `systemPrompt: string[]` (main prompt, eval
// prelude guidance blocks, the `<project-context>` block), `tools` on the
// context, role `developer` for custom/hook messages, `attribution` fields.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeContext, type Api, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import type {
	DriverSnapshot,
	DriverState,
	DriverTurnRequest,
	TurnDriver,
	TurnHandle,
	TurnOutcome,
} from "../../../src/driver-types.js";

export const REPO_RULES = [
	"<repo-rules>",
	"MUST follow these context files for all tasks:",
	'<file path="/work/app/AGENTS.md">',
	"# app",
	"",
	"Run `npm test` before committing. Never edit generated files under `dist/`.",
	"</file>",
	"</repo-rules>",
].join("\n");

export const DIR_CONTEXT = [
	"<dir-context>",
	"Some directories may have rules; deeper rules override higher ones.",
	"Before changes in these directories, MUST read:",
	"- packages/api/AGENTS.md",
	"</dir-context>",
].join("\n");

export const SKILLS = [
	"<skills>",
	"- brainstorming: Before creating features, components, functionality, or behavior changes: explore intent, requirements, design",
	"- systematic-debugging: Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes",
	"</skills>",
].join("\n");

const MAIN_PROMPT = [
	"You are omp's trusted coding assistant.",
	"",
	"# Engineering",
	"- Correctness, then six-month maintainability. Delete dead weight; prefer boring design to needless abstraction.",
	"",
	"⁂ Runtime",
	"# Skills & Rules",
	"Matching skill → MUST read skill://<name> first.",
	SKILLS,
	"",
	"# Internal URLs",
	"Most FS/bash tools resolve these; path selectors: `read` docs.",
	"- skill://<name>: instructions; append /<path> for a file.",
	"- local://<name>.md: shared artifact.",
	"",
	"# Tool Inventory",
	"read, bash, edit, eval, glob, grep, task, write",
].join("\n");

const PROJECT_PROMPT = [
	"<project-context>",
	"<workstation>",
	"- OS: darwin 27.2.0",
	"- Arch: arm64",
	"</workstation>",
	"",
	REPO_RULES,
	"",
	DIR_CONTEXT,
	"",
	"Context files above auto-loaded. NEVER `grep`/`glob` for `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or similar agent/context files: relevant files already in context; others noise.",
	"</project-context>",
	"",
	"<critical>",
	"- Each response MUST advance the task; completion only stopping condition.",
	"</critical>",
].join("\n");

/** Five parts, the shape OMP sent in every live probe turn. */
export const OMP_SYSTEM_PROMPT: string[] = [
	MAIN_PROMPT,
	"Python helpers take kwargs; `await` marks async helpers; the rest are sync.",
	"JS helpers take the same parameters (camelCase) as positional args or ONE trailing options object.",
	"Session tool names: read, bash, edit, eval, glob, grep, task, write.",
	PROJECT_PROMPT,
];

/** OMP tool objects: schema objects exposing toJsonSchema(), not plain JSON. */
export const OMP_TOOLS = [
	{ name: "read", description: "Read a file", parameters: { toJsonSchema: () => ({ type: "object" }) } },
	{ name: "bash", description: "Run a command", parameters: { toJsonSchema: () => ({ type: "object" }) } },
];

let clock = 1_795_293_592_000;

export function ompUser(text: string): Record<string, unknown> {
	return { role: "user", content: [{ type: "text", text }], attribution: "user", timestamp: ++clock };
}

export function ompDeveloper(content: string | Array<Record<string, unknown>>): Record<string, unknown> {
	const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
	return { role: "developer", content: blocks, attribution: "agent", timestamp: ++clock };
}

export function ompAssistant(text: string, provider = "antigravity"): Record<string, unknown> {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "agy-bridge",
		provider,
		model: "gemini-flash",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: ++clock,
	};
}

export function ompToolResult(toolCallId: string, toolName: string, text: string): Record<string, unknown> {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError: false, timestamp: ++clock };
}

/** An OMP Context as the provider receives it: no system message in
 *  `messages`; prompt and tools ride beside them. */
export function ompContext(parts: { systemPrompt?: string[]; messages: unknown[]; tools?: unknown[] }): TranscriptContext {
	return Object.assign(normalizeContext({ messages: [] }), parts);
}

export const model: Model<Api> = {
	id: "gemini-flash",
	name: "Gemini Flash",
	api: "agy-bridge",
	provider: "antigravity",
	baseUrl: "agy-bridge://antigravity",
	reasoning: false,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 65_536,
};

export function tmpStorePath(): string {
	return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "omp-store-")), "sessions.json");
}

/** Records every turn request; each turn settles OK with no activities. A
 *  fresh turn (no conversationId requested) is assigned `newConversationId`. */
export class FakeDriver implements TurnDriver {
	readonly requests: DriverTurnRequest[] = [];
	readonly state: DriverState = "idle";
	readonly activeHandle: TurnHandle | null = null;

	constructor(private readonly newConversationId = "conv-new") {}

	async run(request: DriverTurnRequest): Promise<TurnHandle> {
		this.requests.push(request);
		const outcome: TurnOutcome = {
			status: "OK",
			response: "ok",
			finished: true,
			aborted: false,
			conversationId: request.conversationId ?? this.newConversationId,
		};
		return { id: `turn-${this.requests.length}`, outcome: Promise.resolve(outcome), next: async () => null, pushExternal: () => {} };
	}

	reentry(): TurnHandle | null {
		return null;
	}

	kickIdle(): void {}

	set onTurnEnd(_fn: ((outcome: TurnOutcome) => void) | undefined) {}

	snapshot(): DriverSnapshot {
		return { state: "idle", stats: { spawns: 0, turns: 0, reused: 0, recycles: 0, recycleReasons: {} }, lifecycle: [] };
	}

	async close(): Promise<void> {}
}
