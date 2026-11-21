// Realm runtime for OMP's subagent model: several sessions share one JS realm,
// one provider registration and one bridge listener (src/omp/runtime.ts).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream, normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { sweepWorkspaceGateGroups } from "../../src/approval-hook.js";
import { bridgeMcpConfigDir, sweepStaleBridgeDirs, TOKEN_HEADER, type McpBridgeDeps } from "../../src/mcp-server.js";
import { __setHostForTests } from "../../src/omp/host.js";
import {
	__resetRealmForTests,
	__setThreadForTests,
	approvalHookScriptPath,
	ompRealm,
	pidTag,
	sessionKindOf,
	type BridgeAttachResult,
	type BridgeEndpoint,
	type SessionPort,
} from "../../src/omp/runtime.js";

const model: Model<Api> = {
	id: "gemini-flash",
	name: "Gemini Flash",
	api: "agy-bridge",
	provider: "antigravity",
	baseUrl: "agy-bridge://antigravity",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 65_536,
};
const context = normalizeContext({ systemPrompt: undefined, messages: [{ role: "user", content: "hi", timestamp: 0 }] });

/** A session as the factory registers it: live id, own provider, own turn state.
 *  Its provider records the session id it served. */
function fakeSession(id: string, kind: "main" | "sub", served: string[] = []) {
	const state: { id: string; active: boolean; conversation?: string } = { id, active: false };
	const port: SessionPort = {
		kind,
		sessionId: () => state.id,
		streamSimple: () => {
			served.push(state.id);
			return createAssistantMessageEventStream();
		},
		hasActiveTurn: () => state.active,
		conversationId: () => state.conversation,
	};
	return { port, state };
}

/** A session's bridge surface: its own catalog; records calls and approvals. */
function surface(tool: string, calls: string[]): McpBridgeDeps {
	return {
		listTools: () => [{ name: tool, description: tool, inputSchema: { type: "object", properties: {} } }],
		onToolCall: async (_callId, name) => {
			calls.push(`${tool}:${name}`);
			return { content: [{ type: "text", text: `${tool} ran ${name}` }], isError: false };
		},
		onApproval: (ticket) => calls.push(`${tool}:approval:${ticket}`),
	};
}

function endpoint(result: BridgeAttachResult): BridgeEndpoint {
	if (!result.ok || !result.handle) throw new Error(`bridge did not attach: ${result.reason ?? "no handle"}`);
	return result.handle;
}

/** One MCP request the way agy sends it; returns the raw SSE body. */
async function rpc(port: number, token: string, method: string, params: object): Promise<string> {
	const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", [TOKEN_HEADER]: token },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	expect(res.status).toBe(200);
	return await res.text();
}

/** Tool names in a tools/list SSE answer. */
function listedTools(sse: string): string[] {
	const data = sse.split("\n").find((line) => line.startsWith("data:"));
	if (!data) throw new Error(`no SSE data line in ${sse}`);
	const payload: unknown = JSON.parse(data.slice("data:".length));
	if (typeof payload !== "object" || payload === null || !("result" in payload)) throw new Error(`no result in ${data}`);
	const result = payload.result;
	if (typeof result !== "object" || result === null || !("tools" in result) || !Array.isArray(result.tools)) {
		throw new Error(`no tools in ${data}`);
	}
	return result.tools.map((tool: unknown) => (typeof tool === "object" && tool !== null && "name" in tool ? String(tool.name) : "?"));
}

/** POST /approval the way the staged hook script does; returns the ticket. */
async function postApproval(port: number, token: string, conversationId: string): Promise<string> {
	const res = await fetch(`http://127.0.0.1:${port}/approval`, {
		method: "POST",
		headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
		body: JSON.stringify({ toolCall: { name: "run_command", args: { CommandLine: "ls" } }, conversationId }),
	});
	const body: unknown = await res.json();
	if (typeof body !== "object" || body === null || !("ticket" in body) || typeof body.ticket !== "string") {
		throw new Error(`no ticket in ${JSON.stringify(body)}`);
	}
	return body.ticket;
}

let tmp: string;
const savedEnv = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-runtime-"));
	process.env.HOME = path.join(tmp, "home");
	process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
});

afterEach(async () => {
	await __resetRealmForTests();
	__setThreadForTests(undefined);
	__setHostForTests(undefined);
	process.env.HOME = savedEnv.HOME;
	process.env.PI_CODING_AGENT_DIR = savedEnv.PI_CODING_AGENT_DIR;
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("provider dispatch", () => {
	it("keeps serving the parent from its own session after a subagent joins", () => {
		const served: string[] = [];
		const realm = ompRealm();
		realm.join(fakeSession("sid-parent", "main", served).port);
		realm.join(fakeSession("sid-child", "sub", served).port);
		realm.streamSimple(model, context, { sessionId: "sid-parent" });
		realm.streamSimple(model, context, { sessionId: "sid-child" });
		expect(served).toEqual(["sid-parent", "sid-child"]);
	});

	it("follows the id the main session switches to (/new, /resume)", () => {
		const served: string[] = [];
		const realm = ompRealm();
		const parent = fakeSession("sid-old", "main", served);
		realm.join(parent.port);
		realm.join(fakeSession("sid-child", "sub", served).port);
		parent.state.id = "sid-new";
		realm.streamSimple(model, context, { sessionId: "sid-new" });
		expect(served).toEqual(["sid-new"]);
	});

	it("sends side turns and clones to their owner, and unknown ids to the main session", () => {
		const served: string[] = [];
		const realm = ompRealm();
		realm.join(fakeSession("sid-parent", "main", served).port);
		realm.join(fakeSession("sid-child", "sub", served).port);
		realm.streamSimple(model, context, { sessionId: "sid-child:side:42" });
		realm.streamSimple(model, context, { sessionId: "sid-parent:tan:7" });
		realm.streamSimple(model, context, { sessionId: "FavourableTiger" });
		realm.streamSimple(model, context, {});
		expect(served).toEqual(["sid-child", "sid-parent", "sid-parent", "sid-parent"]);
	});

	it("hands a session's one-shot calls and side turns to its one-shot provider", () => {
		__setHostForTests("omp");
		const served: string[] = [];
		const realm = ompRealm();
		const oneshot = () => {
			served.push("oneshot");
			return createAssistantMessageEventStream();
		};
		realm.join({ ...fakeSession("sid-parent", "main", served).port, oneshot });
		const withTools = Object.assign(normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] }), { tools: [{ name: "read" }] });
		const agentLoop = { sessionId: "sid-parent", getToolContext: () => ({}) };
		const sideTurn = { sessionId: "sid-parent:side:42", getToolContext: () => ({}) };
		realm.streamSimple(model, withTools, agentLoop);
		// Title and compaction calls: the live session id, no tools.
		realm.streamSimple(model, context, { sessionId: "sid-parent" });
		realm.streamSimple(model, withTools, sideTurn);
		// A pre-spawn judgment rides the main session.
		realm.streamSimple(model, context, { sessionId: "FavourableTiger" });
		expect(served).toEqual(["sid-parent", "oneshot", "oneshot", "oneshot"]);
	});

	it("fails the turn visibly when no session is live", async () => {
		const message = await ompRealm().streamSimple(model, context, { sessionId: "sid-gone" }).result();
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toMatch(/no live session/);
	});
});

describe("bridge listener", () => {
	it("routes each session's token to that session's catalog and tools", async () => {
		const calls: string[] = [];
		const realm = ompRealm();
		const parentAttach = await realm.join(fakeSession("sid-parent", "main").port).attachBridge(surface("parent_probe", calls), () => {});
		const childAttach = await realm.join(fakeSession("sid-child", "sub").port).attachBridge(surface("child_probe", calls), () => {});
		expect(parentAttach.first).toBe(true);
		expect(childAttach.first).toBe(false);
		const parent = endpoint(parentAttach);
		const child = endpoint(childAttach);
		expect(child.port).toBe(parent.port);
		const childList = await rpc(child.port, child.token, "tools/list", {});
		expect(childList).toContain("child_probe");
		expect(childList).not.toContain("parent_probe");
		await rpc(parent.port, parent.token, "tools/call", { name: "echo", arguments: {} });
		expect(calls).toEqual(["parent_probe:echo"]);
	});

	it("keeps the parent's listener, add-dir and hook script when a subagent leaves", async () => {
		const realm = ompRealm();
		const parentSession = realm.join(fakeSession("sid-parent", "main").port);
		const parent = endpoint(await parentSession.attachBridge(surface("parent_probe", []), () => {}));
		const childSession = realm.join(fakeSession("sid-child", "sub").port);
		endpoint(await childSession.attachBridge(surface("child_probe", []), () => {}));
		// What the first session's gate staging writes: the add-dir hooks and the hook script.
		const hooks = path.join(bridgeMcpConfigDir(), ".agents", "hooks.json");
		fs.mkdirSync(path.dirname(hooks), { recursive: true });
		fs.writeFileSync(hooks, "{}\n");
		fs.mkdirSync(path.dirname(approvalHookScriptPath()), { recursive: true });
		fs.writeFileSync(approvalHookScriptPath(), "// staged by the parent\n");

		await childSession.leave();
		expect(realm.liveSessions).toBe(1);
		expect(fs.existsSync(hooks)).toBe(true);
		expect(fs.existsSync(approvalHookScriptPath())).toBe(true);
		expect(await rpc(parent.port, parent.token, "tools/list", {})).toContain("parent_probe");

		await parentSession.leave();
		expect(realm.liveSessions).toBe(0);
		expect(fs.existsSync(bridgeMcpConfigDir())).toBe(false);
		expect(fs.existsSync(approvalHookScriptPath())).toBe(false);
		await expect(fetch(`http://127.0.0.1:${parent.port}/mcp`, { method: "POST" })).rejects.toThrow();
	});

	it("writes no add-dir MCP config carrying the listener token", async () => {
		const realm = ompRealm();
		endpoint(await realm.join(fakeSession("sid-parent", "main").port).attachBridge(surface("parent_probe", []), () => {}));
		endpoint(await realm.join(fakeSession("sid-child", "sub").port).attachBridge(surface("child_probe", []), () => {}));
		expect(fs.existsSync(path.join(bridgeMcpConfigDir(), ".agents", "mcp_config.json"))).toBe(false);
	});

	it("lists no tools on the listener token while several sessions stream", async () => {
		const events: string[] = [];
		const realm = ompRealm();
		const parent = fakeSession("sid-parent", "main");
		const child = fakeSession("sid-child", "sub");
		const { port, realmToken } = endpoint(
			await realm.join(parent.port).attachBridge(surface("parent_probe", []), (event) => events.push(event)),
		);
		endpoint(await realm.join(child.port).attachBridge(surface("child_probe", []), () => {}));

		child.state.active = true;
		expect(listedTools(await rpc(port, realmToken, "tools/list", {}))).toContain("child_probe");

		parent.state.active = true;
		expect(listedTools(await rpc(port, realmToken, "tools/list", {}))).toEqual([]);
		expect(events).toContain("list-tools-refused");
	});

	it("lists no tools on the listener token between turns when several sessions are attached", async () => {
		const realm = ompRealm();
		const { port, realmToken } = endpoint(
			await realm.join(fakeSession("sid-parent", "main").port).attachBridge(surface("parent_probe", []), () => {}),
		);
		endpoint(await realm.join(fakeSession("sid-child", "sub").port).attachBridge(surface("child_probe", []), () => {}));
		expect(listedTools(await rpc(port, realmToken, "tools/list", {}))).toEqual([]);
	});

	it("serves a lone session's catalog on the listener token between turns", async () => {
		const realm = ompRealm();
		const { port, realmToken } = endpoint(
			await realm.join(fakeSession("sid-parent", "main").port).attachBridge(surface("parent_probe", []), () => {}),
		);
		expect(listedTools(await rpc(port, realmToken, "tools/list", {}))).toContain("parent_probe");
	});

	it("serves listener-token calls from the one streaming session and refuses when two stream", async () => {
		const calls: string[] = [];
		const realm = ompRealm();
		const parent = fakeSession("sid-parent", "main");
		const child = fakeSession("sid-child", "sub");
		const { port, realmToken } = endpoint(await realm.join(parent.port).attachBridge(surface("parent_probe", calls), () => {}));
		endpoint(await realm.join(child.port).attachBridge(surface("child_probe", calls), () => {}));

		child.state.active = true;
		await rpc(port, realmToken, "tools/call", { name: "echo", arguments: {} });
		expect(calls).toEqual(["child_probe:echo"]);

		parent.state.active = true;
		expect(await rpc(port, realmToken, "tools/call", { name: "echo", arguments: {} })).toContain(
			"several antigravity sessions are streaming",
		);
		expect(calls).toEqual(["child_probe:echo"]);
	});

	it("sends a listener-token approval to the session that owns its conversation, else denies", async () => {
		const calls: string[] = [];
		const realm = ompRealm();
		const parent = fakeSession("sid-parent", "main");
		const child = fakeSession("sid-child", "sub");
		const { port, realmToken } = endpoint(await realm.join(parent.port).attachBridge(surface("parent_probe", calls), () => {}));
		endpoint(await realm.join(child.port).attachBridge(surface("child_probe", calls), () => {}));
		Object.assign(parent.state, { active: true, conversation: "conv-parent" });
		Object.assign(child.state, { active: true, conversation: "conv-child" });

		const owned = await postApproval(port, realmToken, "conv-child");
		expect(calls).toEqual([`child_probe:approval:${owned}`]);

		const orphan = await postApproval(port, realmToken, "conv-unknown");
		const decision: unknown = await fetch(`http://127.0.0.1:${port}/approval/${orphan}`, {
			headers: { [TOKEN_HEADER]: realmToken },
		}).then((r) => r.json());
		expect(decision).toMatchObject({ decision: "deny", reason: expect.stringContaining("several antigravity sessions are streaming") });
	});
});

describe("per-realm names", () => {
	it("tags per-pid paths with the thread id inside a worker realm", () => {
		expect(pidTag()).toBe(String(process.pid));
		__setThreadForTests({ isMainThread: false, threadId: 3 });
		expect(pidTag()).toBe(`${process.pid}-t3`);
		expect(path.basename(bridgeMcpConfigDir())).toBe(`agy-mcp-${process.pid}-t3`);
		expect(path.basename(approvalHookScriptPath())).toBe(`approval-hook-${process.pid}-t3.js`);
	});

	it("sweeps a dead process's realm dirs, worker-tagged ones included, and keeps this process's", () => {
		const base = path.join(tmp, "bridge");
		for (const name of ["agy-mcp-4194001", "agy-mcp-4194001-t2", `agy-mcp-${process.pid}-t2`]) {
			fs.mkdirSync(path.join(base, name), { recursive: true });
		}
		sweepStaleBridgeDirs(base, (pid) => pid === process.pid);
		expect(fs.readdirSync(base)).toEqual([`agy-mcp-${process.pid}-t2`]);
	});

	it("attributes a worker-tagged legacy gate group to its process", () => {
		const ws = path.join(tmp, "ws");
		fs.mkdirSync(path.join(ws, ".agents"), { recursive: true });
		const group = (script: string) => ({ PreToolUse: [{ hooks: [{ type: "command", command: `node ${script}` }] }] });
		const hooks = path.join(ws, ".agents", "hooks.json");
		fs.writeFileSync(
			hooks,
			JSON.stringify({
				"pi-bridge-gate-4194001-t2": group("/x/approval-hook-4194001-t2.js"),
				"pi-bridge-gate-1-t2": group("/x/approval-hook-1-t2.js"),
			}),
		);
		expect(sweepWorkspaceGateGroups(ws)).toBe(1);
		expect(Object.keys(JSON.parse(fs.readFileSync(hooks, "utf8")))).toEqual(["pi-bridge-gate-1-t2"]);
	});
});

describe("sessionKindOf", () => {
	it("treats a context without ctx.agent (pi) as the main session", () => {
		expect(sessionKindOf({ hasUI: true })).toBe("main");
		expect(sessionKindOf({ agent: { kind: "main" } })).toBe("main");
		expect(sessionKindOf({ agent: { kind: "sub" } })).toBe("sub");
	});
});
