// OMP sessions on the stream-json engine with an isolated agy home: the real
// factory, bound once per session the way OMP binds it, against a fake agy
// (tests/helpers/fake-agy-stream.mjs) that logs every spawn with its argv.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../../extensions/index.js";
import { TOKEN_HEADER } from "../../src/mcp-server.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { __resetRealmForTests, type BridgeStreamSimple } from "../../src/omp/runtime.js";
import { model, OMP_TOOLS, ompContext, ompUser } from "./fixtures/omp-context.js";

const FAKE_AGY = fileURLToPath(new URL("../helpers/fake-agy-stream.mjs", import.meta.url));

type Handler = (event: unknown, ctx: unknown) => unknown;

/** OMP's process-wide custom-API registry: the last registration per api wins. */
const customApis = new Map<string, BridgeStreamSimple>();

/** Hand-built OMP-shaped ExtensionAPI for one session (`pi.pi.settings` marks the host). */
function ompSession(kind: "main" | "sub", sessionId: string, tools: string[]) {
	const handlers = new Map<string, Handler[]>();
	const fake = {
		pi: { settings: {} },
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerProvider: (_name: string, config: { api: string; streamSimple: BridgeStreamSimple }) =>
			customApis.set(config.api, config.streamSimple),
		registerTool: () => {},
		registerCommand: () => {},
		registerMessageRenderer: () => {},
		appendEntry: () => {},
		sendMessage: () => {},
		getCommands: () => [],
		getAllTools: () =>
			tools.map((name) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} }, sourceInfo: { source: "extension" } })),
		getActiveTools: () => tools,
	};
	const ctx = {
		agent: { kind, id: kind === "main" ? "Main" : "0-Task", name: kind === "main" ? "main" : "task", depth: kind === "main" ? 0 : 1 },
		hasUI: false,
		mode: "print",
		cwd: process.cwd(),
		ui: { notify: () => {}, setStatus: () => {} },
		isProjectTrusted: () => true,
		getSystemPrompt: () => [],
		sessionManager: { getSessionId: () => sessionId, getEntries: () => [] },
	};
	return {
		// Hand-built fake of the full ExtensionAPI surface; the factory only uses the members above.
		api: fake as unknown as ExtensionAPI,
		emit: async (event: "session_start" | "session_shutdown") => {
			for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
		},
	};
}

function provider(): BridgeStreamSimple {
	const streamSimple = customApis.get("agy-bridge");
	if (!streamSimple) throw new Error("no agy-bridge provider registered");
	return streamSimple;
}

async function replyText(stream: AssistantMessageEventStream): Promise<string> {
	const message = await stream.result();
	const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return text || `(${message.stopReason}: ${message.errorMessage ?? ""})`;
}

/** An agent-loop turn: OMP passes the session's tools and getToolContext. */
function agentTurn(sessionId: string, text: string, signal?: AbortSignal): AssistantMessageEventStream {
	const context = ompContext({ tools: OMP_TOOLS, messages: [ompUser(text)] });
	return provider()(model, context, { sessionId, signal, getToolContext: () => ({}) } as Parameters<BridgeStreamSimple>[2]);
}

/** An OMP one-shot call (compaction, title): the live session id, no tools, no getToolContext. */
function oneshotCall(sessionId: string, text: string): Promise<string> {
	return replyText(provider()(model, ompContext({ messages: [ompUser(text)] }), { sessionId }));
}

/** pid of the fake agy process that answered (`<prompt> from <pid>`). */
function answeredBy(reply: string): string {
	const pid = / from (\d+)$/.exec(reply)?.[1];
	if (!pid) throw new Error(`not a fake agy reply: ${reply}`);
	return pid;
}

let tmp: string;
let agyLog: string;

function spawns(): Array<{ pid: number; argv: string[] }> {
	if (!fs.existsSync(agyLog)) return [];
	return fs
		.readFileSync(agyLog, "utf8")
		.trim()
		.split("\n")
		.map((line): unknown => JSON.parse(line))
		.flatMap((entry) =>
			typeof entry === "object" && entry !== null && "event" in entry && entry.event === "spawn" && "pid" in entry && "argv" in entry && Array.isArray(entry.argv)
				? [{ pid: Number(entry.pid), argv: entry.argv.map(String) }]
				: [],
		);
}

function flagValues(argv: string[], flag: string): string[] {
	return argv.flatMap((arg, i) => (arg === flag && i + 1 < argv.length ? [argv[i + 1]] : []));
}

/** tools/list (raw answer) through the bridge entry of the staged home a spawn received. */
async function catalogOfStagedEntry(argv: string[]): Promise<string> {
	const [home] = flagValues(argv, "--gemini_dir");
	const config: unknown = JSON.parse(fs.readFileSync(path.join(home, "config", "mcp_config.json"), "utf8"));
	const servers = typeof config === "object" && config !== null && "mcpServers" in config ? config.mcpServers : undefined;
	const bridges = Object.entries(typeof servers === "object" && servers !== null ? servers : {}).filter(([name]) => name.startsWith("pi-bridge-"));
	expect(bridges).toHaveLength(1);
	const entry: unknown = bridges[0][1];
	if (typeof entry !== "object" || entry === null || !("serverUrl" in entry) || !("headers" in entry)) throw new Error("malformed bridge entry");
	const headers = entry.headers;
	const token = typeof headers === "object" && headers !== null && TOKEN_HEADER in headers ? String(Reflect.get(headers, TOKEN_HEADER)) : "";
	const res = await fetch(String(entry.serverUrl), {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", [TOKEN_HEADER]: token },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
	return await res.text();
}

const ENV_KEYS = ["HOME", "PI_CODING_AGENT_DIR", "AGY_BIN", "AGY_ENGINE", "AGY_APPROVALS", "AGY_AGENTS_ROOT", "FAKE_AGY_LOG"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-stream-"));
	agyLog = path.join(tmp, "agy.jsonl");
	const bin = path.join(tmp, "bin", "agy");
	fs.mkdirSync(path.dirname(bin), { recursive: true });
	fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_AGY}" "$@"\n`, { mode: 0o755 });
	process.env.HOME = path.join(tmp, "home");
	process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
	process.env.AGY_BIN = bin;
	process.env.AGY_ENGINE = "stream-json";
	process.env.AGY_APPROVALS = "shadow";
	process.env.FAKE_AGY_LOG = agyLog;
	delete process.env.AGY_AGENTS_ROOT;
	__setHostForTests("omp");
	customApis.clear();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	await __resetRealmForTests();
	__setHostForTests(undefined);
	vi.restoreAllMocks();
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("OMP sessions on stream-json", () => {
	it("gives each session's agy its own bridge route and no MCP config carrying the listener token", async () => {
		const parent = ompSession("main", "sid-parent", ["parent_probe"]);
		await bridgeExtension(parent.api);
		await parent.emit("session_start");
		const child = ompSession("sub", "sid-child", ["child_probe"]);
		await bridgeExtension(child.api);
		await child.emit("session_start");

		expect(await replyText(agentTurn("sid-parent", "ONE"))).toMatch(/^ONE from \d+$/);
		expect(await replyText(agentTurn("sid-child", "TWO"))).toMatch(/^TWO from \d+$/);
		const [parentSpawn, childSpawn] = spawns();
		expect(spawns()).toHaveLength(2);

		// Each agy reaches the bridge through its own staged home, on its own session's route.
		expect(await catalogOfStagedEntry(parentSpawn.argv)).toContain("parent_probe");
		expect(await catalogOfStagedEntry(parentSpawn.argv)).not.toContain("child_probe");
		expect(await catalogOfStagedEntry(childSpawn.argv)).toContain("child_probe");
		expect(await catalogOfStagedEntry(childSpawn.argv)).not.toContain("parent_probe");
		// The shared add-dir carries the approval hooks (listener token) and no MCP config.
		for (const { argv } of [parentSpawn, childSpawn]) {
			const extraDirs = flagValues(argv, "--add-dir").filter((dir) => dir !== process.cwd());
			expect(extraDirs.some((dir) => fs.existsSync(path.join(dir, ".agents", "hooks.json")))).toBe(true);
			for (const dir of extraDirs) expect(fs.existsSync(path.join(dir, ".agents", "mcp_config.json"))).toBe(false);
		}

		await child.emit("session_shutdown");
		await parent.emit("session_shutdown");
	}, 30_000);

	it("keeps the session's warm agy across a one-shot call", async () => {
		const main = ompSession("main", "sid-main", []);
		await bridgeExtension(main.api);
		await main.emit("session_start");

		const first = answeredBy(await replyText(agentTurn("sid-main", "ONE")));
		const oneshot = answeredBy(await oneshotCall("sid-main", "PING"));
		const second = answeredBy(await replyText(agentTurn("sid-main", "TWO")));
		expect(oneshot).not.toBe(first);
		expect(second).toBe(first);
		// The one-shot's agy is closed once its turn settles, its isolated home with it.
		const [oneshotHome] = spawns().flatMap(({ pid, argv }) => (String(pid) === oneshot ? flagValues(argv, "--gemini_dir") : []));
		expect(oneshotHome).toBeDefined();
		await vi.waitFor(() => expect(fs.existsSync(oneshotHome)).toBe(false));

		await main.emit("session_shutdown");
	}, 30_000);

	it("answers a one-shot call while the session's turn is still open", async () => {
		const main = ompSession("main", "sid-main", []);
		await bridgeExtension(main.api);
		await main.emit("session_start");
		const abort = new AbortController();
		const held = agentTurn("sid-main", "HOLD", abort.signal);
		let heldSettled = false;
		void held.result().then(() => (heldSettled = true));
		await vi.waitFor(() => expect(spawns()).toHaveLength(1));

		// Queued behind the open turn, this call would never settle (test timeout).
		expect(await oneshotCall("sid-main", "PING")).toMatch(/^PING from \d+$/);
		expect(heldSettled).toBe(false);

		abort.abort();
		await held.result();
		await main.emit("session_shutdown");
	}, 15_000);

	it("closes an in-flight one-shot agy when the session shuts down", async () => {
		const main = ompSession("main", "sid-main", []);
		await bridgeExtension(main.api);
		await main.emit("session_start");
		const pending = oneshotCall("sid-main", "HOLD");
		await vi.waitFor(() => expect(spawns()).toHaveLength(1));
		const [home] = flagValues(spawns()[0].argv, "--gemini_dir");

		await main.emit("session_shutdown");
		expect(await pending).toMatch(/shut down mid-turn/);
		expect(fs.existsSync(home)).toBe(false);
	}, 15_000);
});
