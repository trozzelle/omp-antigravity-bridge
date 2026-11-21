import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	COMPACTION_RESUME_PROMPT,
	ToolRoundTrips,
	buildContextDigest,
	compactionFingerprint,
	createStreamSimple,
	findLastCompactionIdx,
} from "../../src/provider.js";
import { SessionStore } from "../../src/sessions.js";
import { __setHostForTests } from "../../src/omp/host.js";
import {
	FakeDriver,
	OMP_TOOLS,
	model,
	ompAssistant,
	ompContext,
	ompToolResult,
	ompUser,
	tmpStorePath,
} from "./fixtures/omp-context.js";

beforeEach(() => __setHostForTests("omp"));
afterEach(() => __setHostForTests(undefined));

const SID = "01a1ffd6-3a1e-7080-bdf2-f2f7143a3fe9";
const LIVE_KEY = `sid:${SID}@acp`;
const SUMMARY = '## Goal\nReply with "PONG" to complete a basic ping check.\n\n## Next Steps\n1. Await next instruction';

/** OMP renders compaction summaries as role user via these templates
 *  (packages/agent/src/compaction/prompts/*-summary-context.md). */
const compactionText = (summary: string) =>
	`Prior model work/tool state available.\nMUST build on prior work; NEVER duplicate prior work.\n\n<summary>\n${summary}\n</summary>`;
const handoffText = (summary: string) =>
	[
		"Context replaced. The <handoff> below is a handoff document a prior instance of you wrote from the full conversation. It is your own working memory, not user input.",
		"- First person inside it refers to you (the prior instance).",
		'- "Next Steps" is your own resumed plan; re-check it against the latest user message before acting.',
		"- The handoff already exists and is complete: NEVER write another handoff document unless the user explicitly asks.",
		"MUST build on prior work; NEVER duplicate prior work.",
		"",
		"<handoff>",
		summary,
		"</handoff>",
	].join("\n");
const branchText = (summary: string) => `Branch-return summary:\n\n<summary>\n${summary}\n</summary>`;
const summaryMessage = (text: string) => ({ ...ompUser(text), attribution: "agent", historyRewriteAt: 1_795_293_650_000 });

type TurnOptions = SimpleStreamOptions & { cwd: string; getToolContext?: () => object };

/** One ACP turn against a store whose live key is already bound (unless `bound` is false). */
async function turn(context: ReturnType<typeof ompContext>, options: TurnOptions, bound = true) {
	const store = new SessionStore(tmpStorePath());
	if (bound) store.set(LIVE_KEY, { conversationId: "conv-live", lastStepIdx: -1, lastMessageCount: 1 });
	const driver = new FakeDriver("conv-fresh");
	const streamSimple = createStreamSimple({
		entries: [{ full: "gemini-3.6-flash", id: "gemini-flash" }],
		store,
		acpDriver: driver,
		driver,
		roundTrips: new ToolRoundTrips(driver),
		engine: "acp",
	});
	await streamSimple(model, context, options).result();
	return { store, request: driver.requests[0] };
}

const agentOptions = (sessionId: string): TurnOptions => ({ sessionId, cwd: process.cwd(), getToolContext: () => ({}) });
const summarizerCall = () =>
	ompContext({
		systemPrompt: ["You are a summarization assistant. Summarize the conversation for another model."],
		messages: [ompUser("<conversation>\nReply with exactly: PONG\n</conversation>\n\nYou MUST summarize the conversation above.")],
	});

describe("OMP one-shot calls never bind the session's agy conversation", () => {
	it("runs a compaction summarizer call in a fresh conversation and leaves the binding alone", async () => {
		const { store, request } = await turn(summarizerCall(), { sessionId: SID, cwd: process.cwd() });
		expect(request?.conversationId).toBeNull();
		expect(store.get(LIVE_KEY)?.conversationId).toBe("conv-live");
	});

	it("still resumes the bound conversation on an agent-loop turn", async () => {
		const context = ompContext({ tools: OMP_TOOLS, messages: [ompUser("Reply with exactly: PONG3")] });
		const { request } = await turn(context, agentOptions(SID));
		expect(request?.conversationId).toBe("conv-live");
	});

	it("keeps /btw side turns ephemeral", async () => {
		const sideId = `${SID}:side:15d741fa4ca556e9`;
		const context = ompContext({ tools: OMP_TOOLS, messages: [ompUser("quick question")] });
		const { store, request } = await turn(context, agentOptions(sideId));
		expect(request?.conversationId).toBeNull();
		expect(store.get(`sid:${sideId}@acp`)).toBeNull();
	});

	it("leaves pi's tool-less calls bound (heuristic is OMP-only)", async () => {
		__setHostForTests("pi");
		const { request } = await turn(summarizerCall(), { sessionId: SID, cwd: process.cwd() });
		expect(request?.conversationId).toBe("conv-live");
	});
});

describe("OMP compaction summaries in the digest", () => {
	it("isolates the compaction summary body and ships it once", () => {
		const messages = ompContext({
			messages: [summaryMessage(compactionText(SUMMARY)), ompAssistant("PONG", "anthropic"), ompUser("Reply with exactly: PONG3")],
		}).messages;
		expect(findLastCompactionIdx(messages)).toBe(0);
		expect(buildContextDigest(messages, 0)).toBe(`[pi compaction summary]\n${SUMMARY}\n\n[assistant turn from anthropic]\nPONG`);
		expect(buildContextDigest(messages, 0, { seenSummaryId: compactionFingerprint(messages[0]) })).toBe(
			"[assistant turn from anthropic]\nPONG",
		);
	});

	it("unwraps a handoff summary", () => {
		const messages = ompContext({ messages: [summaryMessage(handoffText(SUMMARY)), ompUser("continue")] }).messages;
		expect(buildContextDigest(messages, 0)).toBe(`[pi compaction summary]\n${SUMMARY}`);
	});

	it("does not treat a branch summary as a compaction", () => {
		const messages = ompContext({ messages: [summaryMessage(branchText(SUMMARY)), ompUser("continue")] }).messages;
		expect(findLastCompactionIdx(messages)).toBe(-1);
		expect(buildContextDigest(messages, 0)).toBe(`[earlier user message]\n${branchText(SUMMARY)}`);
	});

	it("resumes into a fresh conversation after compaction mid-tool-loop", async () => {
		const context = ompContext({
			tools: OMP_TOOLS,
			messages: [summaryMessage(compactionText(SUMMARY)), ompAssistant("Running the tests."), ompToolResult("call-1", "bash", "2 passed")],
		});
		const { request } = await turn(context, agentOptions(SID), false);
		expect(request?.prompt).toBe(COMPACTION_RESUME_PROMPT);
		expect(request?.contextBlock?.text).toContain(`[pi compaction summary]\n${SUMMARY}`);
	});

	it("ignores OMP's template text under pi", () => {
		__setHostForTests("pi");
		const messages = ompContext({ messages: [summaryMessage(compactionText(SUMMARY)), ompUser("continue")] }).messages;
		expect(findLastCompactionIdx(messages)).toBe(-1);
	});
});
