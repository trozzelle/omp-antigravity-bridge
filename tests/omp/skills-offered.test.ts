// The OMP system-prompt reduction points agy at the bridge's activate_skill
// tool only when the bridge serves it (src/omp/context.ts). Runs the real
// factory against a fake `agy acp` (tests/helpers/fake-acp-server.mjs) and
// reads the prompt the first turn sent.

import fs from "node:fs";
import type * as Http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../../extensions/index.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { __resetRealmForTests, type BridgeStreamSimple } from "../../src/omp/runtime.js";
import { model, OMP_SYSTEM_PROMPT, OMP_TOOLS, ompContext, ompUser } from "./fixtures/omp-context.js";

const listener = vi.hoisted(() => ({ fails: false }));

// The bridge listener's bind fails the way a refused loopback port does
// (src/mcp-server.ts is the only http.createServer caller).
vi.mock("node:http", async (importOriginal) => {
	const actual = await importOriginal<typeof Http>();
	// Mock factories run before the file's static imports are bound.
	const { EventEmitter } = await import("node:events");
	class RefusedServer extends EventEmitter {
		listen(): this {
			queueMicrotask(() => this.emit("error", new Error("listen EACCES: permission denied 127.0.0.1")));
			return this;
		}
		close(done?: () => void): this {
			done?.();
			return this;
		}
	}
	const createServer = (...args: Parameters<typeof actual.createServer>) =>
		listener.fails ? (new RefusedServer() as unknown as Http.Server) : actual.createServer(...args);
	// mcp-server.ts uses the default import (`http.createServer`).
	return { ...actual, createServer, default: { ...actual, createServer } };
});

const FAKE_ACP_SERVER = fileURLToPath(new URL("../helpers/fake-acp-server.mjs", import.meta.url));

type Handler = (event: unknown, ctx: unknown) => unknown;

let tmp: string;
let acpLog: string;
let streamSimple: BridgeStreamSimple | undefined;

/** One OMP main session whose skill list holds `brainstorming` (listed in OMP_SYSTEM_PROMPT). */
async function startSession(): Promise<{ shutdown: () => Promise<void> }> {
	const handlers = new Map<string, Handler[]>();
	const skillFile = path.join(tmp, "skills", "brainstorming", "SKILL.md");
	fs.mkdirSync(path.dirname(skillFile), { recursive: true });
	fs.writeFileSync(skillFile, "---\nname: brainstorming\n---\nExplore intent first.\n");
	const fake = {
		pi: { settings: {} },
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerProvider: (_name: string, config: { streamSimple: BridgeStreamSimple }) => (streamSimple = config.streamSimple),
		registerTool: () => {},
		registerCommand: () => {},
		registerMessageRenderer: () => {},
		appendEntry: () => {},
		sendMessage: () => {},
		getCommands: () => [{ name: "skill:brainstorming", source: "skill", description: "Explore intent before building", path: skillFile }],
		getAllTools: () => [],
		getActiveTools: () => [],
	};
	const ctx = {
		agent: { kind: "main", id: "Main", name: "main", depth: 0 },
		hasUI: false,
		mode: "print",
		cwd: process.cwd(),
		ui: { notify: () => {}, setStatus: () => {} },
		isProjectTrusted: () => true,
		getSystemPrompt: () => OMP_SYSTEM_PROMPT,
		sessionManager: { getSessionId: () => "sid-main", getEntries: () => [] },
	};
	const emit = async (event: string) => {
		for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
	};
	// Hand-built fake of the full ExtensionAPI surface; the factory only uses the members above.
	await bridgeExtension(fake as unknown as ExtensionAPI);
	await emit("session_start");
	return { shutdown: () => emit("session_shutdown") };
}

/** Run one agent-loop turn and return the prompt text agy received. */
async function firstPrompt(): Promise<string> {
	if (!streamSimple) throw new Error("no provider registered");
	const context = ompContext({ systemPrompt: OMP_SYSTEM_PROMPT, tools: OMP_TOOLS, messages: [ompUser("hi")] });
	const options = { sessionId: "sid-main", getToolContext: () => ({}) };
	await streamSimple(model, context, options).result();
	const prompt = fs
		.readFileSync(acpLog, "utf8")
		.split("\n")
		.find((line) => line.includes('"session/prompt"'));
	if (!prompt) throw new Error("agy never received a prompt");
	return prompt;
}

const ENV_KEYS = ["HOME", "PI_CODING_AGENT_DIR", "AGY_BIN", "AGY_ENGINE", "ACP_FAKE_SCENARIO", "ACP_FAKE_LOG"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-skills-offered-"));
	acpLog = path.join(tmp, "acp.jsonl");
	const bin = path.join(tmp, "bin", "agy");
	fs.mkdirSync(path.dirname(bin), { recursive: true });
	fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = "acp" ] && exec "${process.execPath}" "${FAKE_ACP_SERVER}"\nexit 1\n`, { mode: 0o755 });
	process.env.HOME = path.join(tmp, "home");
	process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
	process.env.AGY_BIN = bin;
	process.env.AGY_ENGINE = "acp";
	process.env.ACP_FAKE_SCENARIO = "happy";
	process.env.ACP_FAKE_LOG = acpLog;
	__setHostForTests("omp");
	streamSimple = undefined;
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
	listener.fails = false;
	await __resetRealmForTests();
	__setHostForTests(undefined);
	vi.restoreAllMocks();
	for (const [key, value] of savedEnv) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	fs.rmSync(tmp, { recursive: true, force: true });
});

describe("activate_skill in the reduced system prompt (OMP)", () => {
	it("points agy at activate_skill when the bridge serves the session's skills", async () => {
		const session = await startSession();
		const prompt = await firstPrompt();
		expect(prompt).toContain("activate_skill");
		expect(prompt).toContain("brainstorming");
		await session.shutdown();
	}, 30_000);

	it("leaves activate_skill out when the bridge failed to start", async () => {
		listener.fails = true;
		const session = await startSession();
		const prompt = await firstPrompt();
		expect(prompt).toContain("<repo-rules>");
		expect(prompt).not.toContain("activate_skill");
		await session.shutdown();
	}, 30_000);
});
