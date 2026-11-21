import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import {
	SYSTEM_PROMPT_END,
	SYSTEM_PROMPT_PREAMBLE,
	TOOL_PRIORITY_NOTE,
	ToolRoundTrips,
	buildContextDigest,
	createStreamSimple,
} from "../../src/provider.js";
import { SessionStore } from "../../src/sessions.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { OMP_DEFAULT_PROMPT_IDENTITY, OMP_SKILLS_INTRO, ompSystemPromptText } from "../../src/omp/context.js";
import {
	DIR_CONTEXT,
	FakeDriver,
	OMP_SYSTEM_PROMPT,
	OMP_TOOLS,
	REPO_RULES,
	SKILLS,
	model,
	ompAssistant,
	ompContext,
	ompDeveloper,
	ompUser,
	tmpStorePath,
} from "./fixtures/omp-context.js";

beforeEach(() => __setHostForTests("omp"));
afterEach(() => __setHostForTests(undefined));

const REDUCED = `${REPO_RULES}\n\n${DIR_CONTEXT}\n\n${OMP_SKILLS_INTRO}\n${SKILLS}`;

/** One agent-loop turn through the real provider (ACP unless stated);
 *  returns the driver request. */
async function runAcpTurn(
	context: ReturnType<typeof ompContext>,
	skillsToolOffered?: () => boolean,
	engine: "acp" | "stream-json" = "acp",
) {
	const driver = new FakeDriver();
	const streamSimple = createStreamSimple({
		entries: [{ full: "gemini-3.6-flash", id: "gemini-flash" }],
		store: new SessionStore(tmpStorePath()),
		// The provider infers the engine from which slot the driver sits in.
		...(engine === "acp" ? { acpDriver: driver } : { driver }),
		roundTrips: new ToolRoundTrips(driver),
		engine,
		skillsToolOffered,
	});
	const options: SimpleStreamOptions & { cwd: string; getToolContext: () => object } = {
		sessionId: "omp-session-1",
		cwd: process.cwd(),
		getToolContext: () => ({}),
	};
	const message = await streamSimple(model, context, options).result();
	return { message, request: driver.requests[0] };
}

/** A prompt rendered from OMP's custom-system-prompt.md: the user's text,
 *  then OMP's skills intro and `<skill>` entries inside `<skills>`. */
const CUSTOM_TEMPLATE_PROMPT = [
	"You are a terse code reviewer. Answer in one sentence.",
	"Skills are specialized knowledge. Scan descriptions for your task domain.",
	"If a skill applies, you MUST read `skill://<name>` before proceeding.",
	"<skills>",
	'<skill name="brainstorming">',
	"Before creating features: explore intent, requirements, design",
	"</skill>",
	"</skills>",
].join("\n");

describe("OMP system prompt reduction", () => {
	it("recognises OMP's default template by its first line", () => {
		// Drift pin: if OMP rewords the first line of
		// packages/coding-agent/src/prompts/system/system-prompt.md, every
		// default prompt would pass through unreduced (~36 KB).
		expect(OMP_DEFAULT_PROMPT_IDENTITY).toBe("You are omp's trusted coding assistant.");
		expect(OMP_SYSTEM_PROMPT[0]?.startsWith(OMP_DEFAULT_PROMPT_IDENTITY)).toBe(true);
	});

	it("keeps only the context-file blocks and the skills list, introduced for activate_skill", () => {
		expect(ompSystemPromptText(OMP_SYSTEM_PROMPT, { skillsTool: true })).toBe(REDUCED);
	});

	it("drops the skills list when activate_skill is not offered", () => {
		expect(ompSystemPromptText(OMP_SYSTEM_PROMPT, { skillsTool: false })).toBe(`${REPO_RULES}\n\n${DIR_CONTEXT}`);
	});

	it("sends a custom-template prompt unchanged even though it carries a skills block", () => {
		expect(ompSystemPromptText([CUSTOM_TEMPLATE_PROMPT, "Session tool names: read, bash."], { skillsTool: true })).toBe(
			`${CUSTOM_TEMPLATE_PROMPT}\n\nSession tool names: read, bash.`,
		);
	});

	it("ignores tag names that appear inline inside an AGENTS.md file", () => {
		const rules = REPO_RULES.replace("Run `npm test`", "Keep the <skills> list short. Run `npm test`");
		const prompt = [`${OMP_DEFAULT_PROMPT_IDENTITY}\n\n${SKILLS}`, `<project-context>\n${rules}\n</project-context>`];
		expect(ompSystemPromptText(prompt, { skillsTool: true })).toBe(`${rules}\n\n${OMP_SKILLS_INTRO}\n${SKILLS}`);
	});

	describe("element by element", () => {
		const GENERIC_RULES = "<generic-rules>\nAlways run the formatter before committing.\n</generic-rules>";
		const WORKSPACE_ROOTS = [
			"<workspace-roots>",
			"Additional workspace directories. Use absolute paths under these roots to `read`.",
			"- /work/shared-lib",
			"</workspace-roots>",
		].join("\n");
		const APPEND = "Prefer small commits.\n\nAnswer in English.";
		const SUBAGENT = [
			"⁂ Role",
			"You are a read-only reviewer.",
			"",
			"# Working Tree",
			"NEVER modify files outside this tree: /tmp/wt/review.",
			"",
			"⁂ Completion",
			"Call `yield` with your findings.",
		].join("\n");
		const body = `${OMP_DEFAULT_PROMPT_IDENTITY}\n\n# Engineering\n- Correctness first.\n\n⁂ Runtime\n${SKILLS}\n\n${GENERIC_RULES}\n\n<domain-rules>\n- ts-style (*.ts): TypeScript style\n</domain-rules>\n\n# Tool Inventory\nread, bash`;
		const project = [
			"<project-context>",
			"<workstation>",
			"- OS: darwin",
			"</workstation>",
			"",
			REPO_RULES,
			"",
			DIR_CONTEXT,
			"",
			"<workspace-tree>",
			"src/",
			"</workspace-tree>",
			WORKSPACE_ROOTS,
			"</project-context>",
			"",
			"<critical>",
			"- Each response MUST advance the task; completion only stopping condition.",
			"</critical>",
			"",
			APPEND,
		].join("\n");

		it("keeps generic rules, workspace roots and the append prompt", () => {
			expect(ompSystemPromptText([body, project], { skillsTool: true })).toBe(
				[REPO_RULES, DIR_CONTEXT, WORKSPACE_ROOTS, `${OMP_SKILLS_INTRO}\n${SKILLS}`, GENERIC_RULES, APPEND].join("\n\n"),
			);
		});

		it("drops eval guidance between the body and the project prompt", () => {
			const guided = [body, "Python helpers take kwargs; `await` marks async helpers.", project];
			const text = ompSystemPromptText(guided, { skillsTool: false });
			expect(text).not.toContain("Python helpers");
			expect(text).toContain(APPEND);
		});

		it("passes a subagent prompt after the project prompt through unchanged", () => {
			const text = ompSystemPromptText([body, project, SUBAGENT], { skillsTool: true });
			expect(text).toBe(
				[REPO_RULES, DIR_CONTEXT, WORKSPACE_ROOTS, `${OMP_SKILLS_INTRO}\n${SKILLS}`, GENERIC_RULES, APPEND, SUBAGENT].join("\n\n"),
			);
			expect(text.endsWith(SUBAGENT)).toBe(true);
			expect(text).not.toContain("<workstation>");
			expect(text).not.toContain("<domain-rules>");
		});

		it("keeps a subagent prompt even with no skills, rules or append text", () => {
			const bare = ["<project-context>", "<workstation>", "- OS: darwin", "</workstation>", "</project-context>", "", "<critical>", "- Go.", "</critical>"].join("\n");
			expect(ompSystemPromptText([`${OMP_DEFAULT_PROMPT_IDENTITY}\n\n# Engineering`, bare, SUBAGENT], { skillsTool: false })).toBe(SUBAGENT);
		});
	});
});

describe("OMP context in a provider turn", () => {
	it("delivers the reduced system prompt on a fresh conversation", async () => {
		const { request } = await runAcpTurn(
			ompContext({ systemPrompt: OMP_SYSTEM_PROMPT, tools: OMP_TOOLS, messages: [ompUser("Reply with exactly: PONG")] }),
			() => true,
		);
		expect(request?.prompt).toBe(
			`${SYSTEM_PROMPT_PREAMBLE}\n\n${REDUCED}\n\n${TOOL_PRIORITY_NOTE}\n\n${SYSTEM_PROMPT_END}\n\n---\n\nReply with exactly: PONG`,
		);
		expect(request?.prompt).not.toContain("skill://");
	});

	it("leaves the skills list out when the bridge offers no activate_skill", async () => {
		const { request } = await runAcpTurn(
			ompContext({ systemPrompt: OMP_SYSTEM_PROMPT, tools: OMP_TOOLS, messages: [ompUser("Reply with exactly: PONG")] }),
			() => false,
		);
		expect(request?.prompt).toBe(
			`${SYSTEM_PROMPT_PREAMBLE}\n\n${REPO_RULES}\n\n${DIR_CONTEXT}\n\n${TOOL_PRIORITY_NOTE}\n\n${SYSTEM_PROMPT_END}\n\n---\n\nReply with exactly: PONG`,
		);
	});

	describe("default-template prompt with no context files and the skills list dropped", () => {
		/** OMP's default template rendered without AGENTS.md files: no
		 *  repo-rules/dir-context, only the skills list, which is dropped
		 *  because no activate_skill is offered. */
		const bare = ompContext({
			systemPrompt: [
				`${OMP_DEFAULT_PROMPT_IDENTITY}\n\n# Engineering\n- Correctness first.\n\n${SKILLS}`,
				"<project-context>\n<workstation>\n- OS: darwin\n</workstation>\n</project-context>\n\n<critical>\n- Advance the task.\n</critical>",
			],
			tools: OMP_TOOLS,
			messages: [ompUser("Reply with exactly: PONG")],
		});
		const prevAgentsRoot = process.env.AGY_AGENTS_ROOT;
		afterEach(() => {
			if (prevAgentsRoot === undefined) delete process.env.AGY_AGENTS_ROOT;
			else process.env.AGY_AGENTS_ROOT = prevAgentsRoot;
		});

		it("still sends the tool-priority note inline on ACP", async () => {
			const { request } = await runAcpTurn(bare, () => false);
			expect(request?.prompt).toBe(
				`${SYSTEM_PROMPT_PREAMBLE}\n\n${TOOL_PRIORITY_NOTE}\n\n${SYSTEM_PROMPT_END}\n\n---\n\nReply with exactly: PONG`,
			);
		});

		it("still stages the tool-priority note as the carrier agent on stream-json", async () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agents-"));
			process.env.AGY_AGENTS_ROOT = root;
			const { request } = await runAcpTurn(bare, () => false, "stream-json");
			expect(request?.prompt).toBe("Reply with exactly: PONG");
			const agentMd = fs.readFileSync(path.join(root, request?.agent ?? "missing", "agent.md"), "utf8");
			expect(agentMd.endsWith(`\n---\n\n${SYSTEM_PROMPT_PREAMBLE}\n\n${TOOL_PRIORITY_NOTE}\n`)).toBe(true);
			fs.rmSync(root, { recursive: true, force: true });
		});
	});

	it("sends no system prompt block when OMP passes no system prompt at all", async () => {
		const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages: [ompUser("Reply with exactly: PONG")] }), () => true);
		expect(request?.prompt).toBe("Reply with exactly: PONG");
	});

	it("sends a developer-role tail (background wake) as the prompt instead of failing", async () => {
		const wake = "Background run bg_8f90c2f6 on agy finished (ran 5s).\n\nPONG";
		const { message, request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages: [ompDeveloper(wake)] }));
		expect(message.stopReason).toBe("stop");
		expect(request?.prompt).toBe(wake);
	});

	it("sends the user's message together with developer notices OMP appended after it", async () => {
		const { request } = await runAcpTurn(
			ompContext({ tools: OMP_TOOLS, messages: [ompUser("Fix the failing test"), ompDeveloper("<system-reminder>Todo list is empty.</system-reminder>")] }),
		);
		expect(request?.prompt).toBe("Fix the failing test\n\n<system-reminder>Todo list is empty.</system-reminder>");
	});

	it("does not also ship the trailing user message in the context digest", async () => {
		const reminder = "<system-reminder>Todo list is empty.</system-reminder>";
		const messages = [ompUser("earlier ask"), ompAssistant("done", "anthropic"), ompUser("Fix the failing test"), ompDeveloper(reminder)];
		const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages }), undefined, "stream-json");
		const prompt = request?.prompt ?? "";
		expect(prompt.split("Fix the failing test")).toHaveLength(2);
		expect(prompt.split(reminder)).toHaveLength(2);
		expect(prompt).toContain("[earlier user message]\nearlier ask");
	});

	it("keeps the trailing user message out of the ACP embedded context", async () => {
		const messages = [ompUser("earlier ask"), ompAssistant("done", "anthropic"), ompUser("Fix the failing test"), ompDeveloper("<system-reminder>x</system-reminder>")];
		const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages }));
		const embedded = request?.contextBlock?.text ?? "";
		expect(embedded).toContain("earlier ask");
		expect(embedded).not.toContain("Fix the failing test");
	});

	describe("OMP summary messages (role user)", () => {
		const COMPACTION = "Prior model work/tool state available.\n\n<summary>\nWe fixed the parser. UNIQUE-SUMMARY-BODY\n</summary>";
		const BRANCH = "Branch-return summary:\nTried approach B, abandoned. UNIQUE-BRANCH-BODY";

		it("sends only the user's prompt after a compaction summary, and the summary once in the embedded context", async () => {
			const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages: [ompUser(COMPACTION), ompUser("Now fix the lexer")] }));
			expect(request?.prompt).toBe("Now fix the lexer");
			const embedded = request?.contextBlock?.text ?? "";
			expect(embedded.split("UNIQUE-SUMMARY-BODY")).toHaveLength(2);
			expect(embedded).not.toContain("Now fix the lexer");
		});

		it("does not send the compaction summary as the prompt on stream-json either", async () => {
			const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages: [ompUser(COMPACTION), ompUser("Now fix the lexer")] }), undefined, "stream-json");
			const prompt = request?.prompt ?? "";
			expect(prompt.split("UNIQUE-SUMMARY-BODY")).toHaveLength(2);
			expect(prompt.endsWith("Now fix the lexer")).toBe(true);
			expect(prompt.split("Now fix the lexer")).toHaveLength(2);
		});

		it("stops the prompt at a branch summary and keeps that summary in the digest", async () => {
			const messages = [ompUser("Try B"), ompAssistant("trying", "anthropic"), ompUser(BRANCH), ompUser("Back to A")];
			const { request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages }));
			expect(request?.prompt).toBe("Back to A");
			expect(request?.contextBlock?.text).toContain("[earlier user message]\nBranch-return summary:");
		});

		it("falls back to a summary-only tail as the prompt rather than failing", async () => {
			const { message, request } = await runAcpTurn(ompContext({ tools: OMP_TOOLS, messages: [ompUser(COMPACTION)] }));
			expect(message.stopReason).toBe("stop");
			expect(request?.prompt).toContain("UNIQUE-SUMMARY-BODY");
		});
	});

	it("forwards images carried by a developer message", async () => {
		const image = { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" };
		const { request } = await runAcpTurn(
			ompContext({ tools: OMP_TOOLS, messages: [ompDeveloper([{ type: "text", text: "Screenshot attached" }, image])] }),
		);
		expect(request?.images).toEqual([{ data: "iVBORw0KGgo=", mimeType: "image/png" }]);
	});

	it("short-circuits observational-memory workers declared through context.tools", async () => {
		const driver = new FakeDriver();
		const streamSimple = createStreamSimple({
			entries: [{ full: "gemini-3.6-flash", id: "gemini-flash" }],
			store: new SessionStore(tmpStorePath()),
			driver,
			roundTrips: new ToolRoundTrips(driver),
		});
		const context = ompContext({ tools: [{ name: "record_observations" }], messages: [ompUser("observe")] });
		const message = await streamSimple(model, context, { sessionId: "om-worker" }).result();
		expect(message.stopReason).toBe("stop");
		expect(driver.requests).toHaveLength(0);
	});
});

describe("OMP developer messages in the digest", () => {
	it("ends the delta where the trailing user/developer run starts", () => {
		const messages = [ompUser("hi"), ompAssistant("hello", "anthropic"), ompUser("Fix the test"), ompDeveloper("<system-reminder>note</system-reminder>")];
		const digest = buildContextDigest(ompContext({ messages }).messages, 0);
		expect(digest).toContain("[earlier user message]\nhi");
		expect(digest).not.toContain("Fix the test");
		expect(digest).not.toContain("note");
	});

	it("still includes the whole transcript on a compaction resume", () => {
		const messages = [ompUser("hi"), ompAssistant("hello", "anthropic"), ompUser("Fix the test")];
		const digest = buildContextDigest(ompContext({ messages }).messages, 0, { includeLast: true });
		expect(digest).toContain("[earlier user message]\nFix the test");
	});

	it("ships an earlier developer message as session context", () => {
		const messages = [ompUser("hi"), ompAssistant("hello", "anthropic"), ompDeveloper("CI failed on main"), ompAssistant("noted", "anthropic"), ompUser("now?")];
		const digest = buildContextDigest(ompContext({ messages }).messages, 0);
		expect(digest).toContain("[earlier user message]\nCI failed on main");
	});
});
