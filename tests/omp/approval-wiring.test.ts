// Approval-gate wiring at session start, per host: under OMP every session
// registers the one approval tool and only the session that started the realm
// listener stages the shared hook script; under pi the session stages its own
// script and shadows bash/write/edit. Real factory, fake `agy acp`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../../extensions/index.js";
import { logsDir } from "../../src/config.js";
import { bridgeMcpConfigDir } from "../../src/mcp-server.js";
import { OMP_APPROVAL_TOOL_NAME } from "../../src/omp/approval-tool.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { __resetRealmForTests, approvalHookScriptPath } from "../../src/omp/runtime.js";

const FAKE_ACP_SERVER = fileURLToPath(new URL("../helpers/fake-acp-server.mjs", import.meta.url));

type Handler = (event: unknown, ctx: unknown) => unknown;

/** A session on a hand-built ExtensionAPI: OMP-shaped when `kind` is set, pi-shaped otherwise. */
function session(kind?: "main" | "sub") {
	const handlers = new Map<string, Handler[]>();
	const registered: string[] = [];
	const fake = {
		...(kind ? { pi: { settings: {} } } : {}),
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		registerProvider: () => {},
		registerTool: (tool: { name: string }) => registered.push(tool.name),
		registerCommand: () => {},
		registerMessageRenderer: () => {},
		registerEntryRenderer: () => {},
		appendEntry: () => {},
		sendMessage: () => {},
		getCommands: () => [],
		getAllTools: () => [],
		getActiveTools: () => [],
	};
	const ctx = {
		...(kind ? { agent: { kind, id: kind === "main" ? "Main" : "0-Task", name: kind, depth: kind === "main" ? 0 : 1 } } : {}),
		hasUI: false,
		mode: "print",
		cwd: process.cwd(),
		ui: { notify: () => {}, setStatus: () => {} },
		isProjectTrusted: () => true,
		getSystemPrompt: () => [],
		sessionManager: { getSessionId: () => `sid-${kind ?? "pi"}`, getEntries: () => [] },
	};
	return {
		// Hand-built fake of the full ExtensionAPI surface; the factory only uses the members above.
		start: async () => {
			await bridgeExtension(fake as unknown as ExtensionAPI);
			for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start", reason: "startup" }, ctx);
		},
		shutdown: async () => {
			for (const handler of handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown" }, ctx);
		},
		// Everything but the display wrapper and the delegation tool.
		approvalTools: () => registered.filter((name) => name !== "antigravity" && name !== "AskAntigravity"),
	};
}

let tmp: string;
const ENV_KEYS = ["HOME", "PI_CODING_AGENT_DIR", "AGY_BIN", "AGY_ENGINE", "AGY_APPROVALS", "ACP_FAKE_SCENARIO"] as const;
const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omp-approval-wiring-"));
	const bin = path.join(tmp, "bin", "agy");
	fs.mkdirSync(path.dirname(bin), { recursive: true });
	fs.writeFileSync(bin, `#!/bin/sh\n[ "$1" = "acp" ] && exec "${process.execPath}" "${FAKE_ACP_SERVER}"\nexit 1\n`, { mode: 0o755 });
	process.env.HOME = path.join(tmp, "home");
	process.env.PI_CODING_AGENT_DIR = path.join(tmp, "agent");
	process.env.AGY_BIN = bin;
	process.env.AGY_ENGINE = "acp";
	process.env.AGY_APPROVALS = "shadow";
	process.env.ACP_FAKE_SCENARIO = "happy";
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

describe("approval-gate wiring", () => {
	it("OMP: every session registers the approval tool; the first stages the realm's hook script once", async () => {
		__setHostForTests("omp");
		const parent = session("main");
		await parent.start();
		const script = approvalHookScriptPath();
		const hooks = path.join(bridgeMcpConfigDir(), ".agents", "hooks.json");
		expect(fs.existsSync(hooks)).toBe(true);
		fs.appendFileSync(script, "// staged by the parent\n");

		const child = session("sub");
		await child.start();
		expect(parent.approvalTools()).toEqual([OMP_APPROVAL_TOOL_NAME]);
		expect(child.approvalTools()).toEqual([OMP_APPROVAL_TOOL_NAME]);
		expect(fs.readFileSync(script, "utf8")).toContain("// staged by the parent");

		await child.shutdown();
		expect(fs.existsSync(script)).toBe(true);
		await parent.shutdown();
		expect(fs.existsSync(script)).toBe(false);
		expect(fs.existsSync(hooks)).toBe(false);
	}, 30_000);

	it("pi: the session stages its own hook script and shadows bash, write and edit", async () => {
		__setHostForTests("pi");
		const pi = session();
		await pi.start();
		const script = path.join(logsDir(), `approval-hook-${process.pid}.js`);
		expect(fs.existsSync(script)).toBe(true);
		expect(fs.existsSync(path.join(bridgeMcpConfigDir(), ".agents", "hooks.json"))).toBe(true);
		expect(pi.approvalTools().sort()).toEqual(["bash", "edit", "write"]);

		await pi.shutdown();
		expect(fs.existsSync(script)).toBe(false);
	}, 30_000);
});
