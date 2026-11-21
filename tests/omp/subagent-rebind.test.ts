// OMP binds the extension factory again for every subagent session in the
// same realm and keeps only the LAST provider registration per api (live
// repro F2, .superpowers/notes/parity-toolbridge.md section 7). These tests
// run the real factory twice against hand-built OMP-shaped `pi` objects and a
// fake `agy acp` (tests/helpers/fake-acp-server.mjs), then check what a user
// would see: whose tools the parent's agy turn reaches, and whether the
// parent's bridge files survive the subagent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeContext, type Api, type AssistantMessageEventStream, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../../extensions/index.js";
import { bridgeMcpConfigDir, TOKEN_HEADER } from "../../src/mcp-server.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { __resetRealmForTests, approvalHookScriptPath, type BridgeStreamSimple } from "../../src/omp/runtime.js";

const FAKE_ACP_SERVER = fileURLToPath(new URL("../helpers/fake-acp-server.mjs", import.meta.url));

const model: Model<Api> = {
	id: "gemini-3-flash",
	name: "Gemini 3 Flash",
	api: "agy-bridge",
	provider: "antigravity",
	baseUrl: "agy-bridge://antigravity",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 65_536,
};

type Handler = (event: unknown, ctx: unknown) => unknown;

/** OMP's process-wide custom-API registry: the last registration per api wins. */
const customApis = new Map<string, BridgeStreamSimple>();

/** Hand-built OMP-shaped ExtensionAPI (`pi.pi.settings` marks the host) for
 *  one session: records handlers and serves `tools` as its active tool set. */
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

async function turnText(stream: AssistantMessageEventStream): Promise<string> {
	const message = await stream.result();
	const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return text || `(${message.stopReason}: ${message.errorMessage ?? ""})`;
}

function runTurn(sessionId: string): Promise<string> {
	const streamSimple = customApis.get("agy-bridge");
	if (!streamSimple) throw new Error("no agy-bridge provider registered");
	const context = normalizeContext({ systemPrompt: undefined, messages: [{ role: "user", content: "hi", timestamp: Date.now() }] });
	return turnText(streamSimple(model, context, { sessionId }));
}

/** Bridge endpoint (url + token) the fake agy received for its latest session/new or session/load. */
function lastBridgeEndpoint(acpLog: string): { url: string; token: string } {
	const lines = fs.readFileSync(acpLog, "utf8").trim().split("\n");
	for (const line of lines.reverse()) {
		const msg: unknown = JSON.parse(line);
		if (typeof msg !== "object" || msg === null || !("params" in msg)) continue;
		const params = msg.params;
		if (typeof params !== "object" || params === null || !("mcpServers" in params) || !Array.isArray(params.mcpServers)) continue;
		const server: unknown = params.mcpServers[0];
		if (typeof server !== "object" || server === null || !("url" in server) || !("headers" in server)) continue;
		const header: unknown = Array.isArray(server.headers) ? server.headers[0] : undefined;
		if (typeof server.url !== "string" || typeof header !== "object" || header === null || !("value" in header) || typeof header.value !== "string") continue;
		return { url: server.url, token: header.value };
	}
	throw new Error("the fake agy never received a bridge endpoint");
}

/** tools/list on a bridge endpoint, as agy would call it. */
async function listTools(endpoint: { url: string; token: string }): Promise<string> {
	const res = await fetch(endpoint.url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", [TOKEN_HEADER]: endpoint.token },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
	});
	return `${res.status} ${await res.text()}`;
}

let tmp: string;
let acpLog: string;
const ENV_KEYS = ["HOME", "PI_CODING_AGENT_DIR", "AGY_BIN", "AGY_ENGINE", "AGY_APPROVALS", "ACP_FAKE_SCENARIO", "ACP_FAKE_LOG"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-rebind-"));
	acpLog = path.join(tmp, "acp.jsonl");
	const bin = path.join(tmp, "bin", "agy");
	fs.mkdirSync(path.dirname(bin), { recursive: true });
	// `agy acp …` runs the fake ACP server; every other subcommand (models,
	// --version) fails fast so the factory takes its fallback paths.
	fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = "acp" ] && exec "${process.execPath}" "${FAKE_ACP_SERVER}"\nexit 1\n`, { mode: 0o755 });
	process.env.HOME = path.join(tmp, "home");
	process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
	process.env.AGY_BIN = bin;
	process.env.AGY_ENGINE = "acp";
	process.env.AGY_APPROVALS = "shadow";
	process.env.ACP_FAKE_SCENARIO = "happy";
	process.env.ACP_FAKE_LOG = acpLog;
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

describe("subagent factory rebinding (OMP)", () => {
	it("serves the parent's turns from the parent's session after a subagent binds", async () => {
		const parent = ompSession("main", "sid-parent", ["parent_probe"]);
		await bridgeExtension(parent.api);
		await parent.emit("session_start");
		const child = ompSession("sub", "sid-child", ["child_probe"]);
		await bridgeExtension(child.api);
		await child.emit("session_start");

		// The child's registration is the one OMP kept.
		expect(await runTurn("sid-parent")).toBe("HELLO");
		const parentTools = await listTools(lastBridgeEndpoint(acpLog));
		expect(parentTools).toMatch(/^200 /);
		expect(parentTools).toContain("parent_probe");
		expect(parentTools).not.toContain("child_probe");

		expect(await runTurn("sid-child")).toBe("HELLO");
		expect(await listTools(lastBridgeEndpoint(acpLog))).toContain("child_probe");

		await child.emit("session_shutdown");
		await parent.emit("session_shutdown");
	}, 30_000);

	it("keeps the parent's bridge files and endpoint when the subagent shuts down", async () => {
		const parent = ompSession("main", "sid-parent", ["parent_probe"]);
		await bridgeExtension(parent.api);
		await parent.emit("session_start");
		const child = ompSession("sub", "sid-child", ["child_probe"]);
		await bridgeExtension(child.api);
		await child.emit("session_start");
		const agents = path.join(bridgeMcpConfigDir(), ".agents");
		expect(fs.existsSync(path.join(agents, "hooks.json"))).toBe(true);
		expect(fs.existsSync(approvalHookScriptPath())).toBe(true);

		await child.emit("session_shutdown");
		expect(fs.existsSync(path.join(agents, "hooks.json"))).toBe(true);
		expect(fs.existsSync(approvalHookScriptPath())).toBe(true);
		expect(await runTurn("sid-parent")).toBe("HELLO");
		expect(await listTools(lastBridgeEndpoint(acpLog))).toContain("parent_probe");

		await parent.emit("session_shutdown");
		expect(fs.existsSync(bridgeMcpConfigDir())).toBe(false);
		expect(fs.existsSync(approvalHookScriptPath())).toBe(false);
	}, 30_000);

	it("runs process-wide startup notices for the main session only", async () => {
		process.env.AGY_ACP_BIN = "/old/acp";
		try {
			const parent = ompSession("main", "sid-parent", []);
			await bridgeExtension(parent.api);
			await parent.emit("session_start");
			const child = ompSession("sub", "sid-child", []);
			await bridgeExtension(child.api);
			await child.emit("session_start");
			const notices = vi.mocked(console.error).mock.calls.filter((call) => String(call[0]).includes("AGY_ACP_BIN"));
			expect(notices).toHaveLength(1);
			await child.emit("session_shutdown");
			await parent.emit("session_shutdown");
		} finally {
			delete process.env.AGY_ACP_BIN;
		}
	}, 30_000);
});
