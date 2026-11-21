import { createAssistantMessageEventStream, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TurnDiffContext, createExecGitOps } from "../../src/diff-render.js";
import { StreamDriver, type DriverActivity } from "../../src/driver.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { ToolRoundTrips, WrapperReplay, consumeActivity, type BlockState } from "../../src/provider.js";

/** Tools a default OMP 19.1 session has active: no `ls`, no pi-style `find`. */
const OMP_ACTIVE = new Set(["read", "glob", "grep", "antigravity"]);

function newBlocks(): BlockState {
	return {
		partial: {
			role: "assistant",
			content: [],
			api: "agy-bridge",
			provider: "antigravity",
			model: "gemini-3.7-flash-medium",
			usage: {
				input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		},
		textIdx: null,
		thinkingIdx: null,
		started: true,
	};
}

/** Feed one finished agy step through the stream-json activity path and
 *  return the toolCall the host would execute. */
function replayStep(name: string, args: Record<string, unknown>): { name: string; arguments: unknown } {
	const stream = createAssistantMessageEventStream();
	const events: AssistantMessageEvent[] = [];
	const push = stream.push.bind(stream);
	stream.push = (event: AssistantMessageEvent) => {
		events.push(event);
		push(event);
	};
	const activity: DriverActivity = { type: "tool_done", stepId: 1, name, args, output: "agy output" };
	const outcome = consumeActivity(stream, newBlocks(), activity, new TurnDiffContext(createExecGitOps()), "/w", {
		replay: new WrapperReplay(),
		roundTrips: new ToolRoundTrips(new StreamDriver()),
		nativeActive: (tool) => OMP_ACTIVE.has(tool),
	});
	expect(outcome).toBe("parked");
	for (const event of events) {
		if (event.type === "toolcall_end") return { name: event.toolCall.name, arguments: event.toolCall.arguments };
	}
	throw new Error("no toolCall emitted");
}

describe("native re-exec under OMP", () => {
	beforeEach(() => __setHostForTests("omp"));
	afterEach(() => __setHostForTests(undefined));

	it("keeps a view_file line range as an inclusive read selector", () => {
		expect(replayStep("view_file", { path: "/w/hello.txt", StartLine: 2, EndLine: 3 })).toEqual({
			name: "read",
			arguments: { path: "/w/hello.txt:2-3" },
		});
	});

	it("maps agy 1.5.14 read_file the same way", () => {
		expect(replayStep("read_file", { Path: "/w/hello.txt", StartLine: 2, EndLine: 3 })).toEqual({
			name: "read",
			arguments: { path: "/w/hello.txt:2-3" },
		});
	});

	it("reads to end of file from a start line, and the whole file without one", () => {
		expect(replayStep("view_file", { path: "/w/a.ts", StartLine: 5 }).arguments).toEqual({ path: "/w/a.ts:5-" });
		expect(replayStep("view_file", { path: "/w/a.ts" }).arguments).toEqual({ path: "/w/a.ts" });
	});

	it("keeps the range on a Windows drive path", () => {
		expect(replayStep("view_file", { path: "C:\\w\\a.ts", StartLine: 2, EndLine: 3 }).arguments).toEqual({
			path: "C:\\w\\a.ts:2-3",
		});
	});

	it("replays a ranged read of a colon path through the wrapper instead of misreading it", () => {
		expect(replayStep("view_file", { path: "/w/notes:v2.txt", StartLine: 2, EndLine: 3 }).name).toBe("antigravity");
		expect(replayStep("view_file", { path: "/w/notes:v2.txt" })).toEqual({
			name: "read",
			arguments: { path: "/w/notes:v2.txt" },
		});
	});

	it("lists a directory with read, since OMP has no ls", () => {
		expect(replayStep("list_dir", { DirectoryPath: "/w/src" })).toEqual({ name: "read", arguments: { path: "/w/src" } });
	});

	it("finds by name with a recursive glob, since OMP find is semantic search", () => {
		expect(replayStep("find_by_name", { Pattern: "*.txt", SearchDirectory: "/w" })).toEqual({
			name: "glob",
			arguments: { path: "/w", pattern: "**/*.txt" },
		});
		expect(replayStep("find_by_name", { Pattern: "src/**/*.ts", SearchDirectory: "/w" }).arguments).toEqual({
			path: "/w",
			pattern: "src/**/*.ts",
		});
		expect(replayStep("find_by_name", { Pattern: "*.txt" }).arguments).toEqual({ pattern: "*.txt" });
	});

	it("passes grep through without a reasoning argument", () => {
		expect(replayStep("grep_search", { Query: "bravo", SearchPath: "/w" })).toEqual({
			name: "grep",
			arguments: { pattern: "bravo", path: "/w" },
		});
	});
});

describe("native re-exec under pi is unchanged", () => {
	beforeEach(() => __setHostForTests("pi"));
	afterEach(() => __setHostForTests(undefined));

	it("emits read with offset/limit and the reasoning argument pi requires", () => {
		const call = replayStep("view_file", { path: "/w/hello.txt", StartLine: 2, EndLine: 3 });
		expect(call.name).toBe("read");
		expect(call.arguments).toEqual({
			reasoning: "re-exec of agy view_file for display",
			path: "/w/hello.txt",
			offset: 2,
			limit: 2,
		});
	});
});
