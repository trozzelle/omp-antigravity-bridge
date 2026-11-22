// /agy tasks and /agy artifacts through the real factory with a fake host.
// They must resolve the CURRENT session's bound conversation from the session
// store, not the ACP driver snapshot: OMP's auxiliary one-shot calls (title,
// compaction) run on the same driver and leave a throwaway session in it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bridgeExtension from "../../extensions/index.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { __resetRealmForTests } from "../../src/omp/runtime.js";

const BOUND = "bound-conversation";
const SESSION_ID = "session-under-test";

let root: string;
const saved = { agentDir: process.env.PI_CODING_AGENT_DIR, agyBin: process.env.AGY_BIN };

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agy-commands-"));
	process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
	process.env.AGY_BIN = path.join(root, "no-such-agy");
	// Bun reads HOME once at startup; mock the call the brain-dir lookup makes.
	vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
	fs.mkdirSync(path.join(root, "agent", "antigravity-bridge"), { recursive: true });
	fs.writeFileSync(path.join(root, "agent", "antigravity-bridge", "config.json"), JSON.stringify({ engine: "acp" }));
	__setHostForTests(undefined);
	// The realm shares one session store across factory calls in this process.
	__resetRealmForTests();
});

afterEach(() => {
	__setHostForTests(undefined);
	vi.restoreAllMocks();
	for (const [name, value] of [
		["PI_CODING_AGENT_DIR", saved.agentDir],
		["AGY_BIN", saved.agyBin],
	] as const) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
	fs.rmSync(root, { recursive: true, force: true });
});

/** The session store binds this session's engine-scoped key to BOUND. */
function bindSession(): void {
	fs.writeFileSync(
		path.join(root, "agent", "antigravity-bridge", "sessions.json"),
		JSON.stringify({ [`sid:${SESSION_ID}@acp`]: { conversationId: BOUND, lastStepIdx: 3 } }),
	);
}

function writeTaskLog(id: number, body: string): void {
	const dir = path.join(root, "home", ".gemini", "antigravity-cli", "brain", BOUND, ".system_generated", "tasks");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `task-${id}.log`), body);
}

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

/** Real factory on a recording fake; returns the registered /agy handler. */
async function loadAgyCommand(): Promise<CommandHandler> {
	let handler: CommandHandler | undefined;
	const fake = {
		pi: { settings: {} },
		on: () => {},
		registerProvider: () => {},
		registerTool: () => {},
		registerCommand: (name: string, def: { handler: CommandHandler }) => {
			if (name === "agy") handler = def.handler;
		},
		registerMessageRenderer: () => {},
		appendEntry: () => {},
		sendMessage: () => {},
		getCommands: () => [],
		getAllTools: () => [],
		getActiveTools: () => [],
	};
	// Hand-built fake of the ExtensionAPI surface the factory touches at load.
	await bridgeExtension(fake as unknown as ExtensionAPI);
	if (!handler) throw new Error("/agy was not registered");
	return handler;
}

function commandCtx(notes: Array<{ message: string; level: string }>, withUi: boolean) {
	return {
		mode: "print",
		hasUI: withUi,
		cwd: root,
		...(withUi ? { ui: { notify: (message: string, level: string) => notes.push({ message, level }) } } : {}),
		sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
	};
}

describe("/agy tasks and /agy artifacts conversation resolution", () => {
	it("/agy tasks lists the session's bound conversation even when the driver holds none", async () => {
		bindSession();
		writeTaskLog(67, "line one\n");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const agy = await loadAgyCommand();
		await agy("tasks", commandCtx([], false));
		expect(log).toHaveBeenCalledTimes(1);
		expect(String(log.mock.calls[0]?.[0])).toMatch(/antigravity tasks \(1\):\n#67 /);
	});

	it("/agy artifacts lists the session's bound conversation even when the driver holds none", async () => {
		bindSession();
		const dir = path.join(root, "home", ".gemini", "antigravity-cli", "brain", BOUND);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "plan.md"), "# plan\n");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const agy = await loadAgyCommand();
		await agy("artifacts", commandCtx([], false));
		expect(log).toHaveBeenCalledTimes(1);
		expect(String(log.mock.calls[0]?.[0])).toMatch(/antigravity artifacts \(1\):\n0 {2}plan\.md /);
	});

	it("with no binding and no driver conversation both commands say nothing is bound yet", async () => {
		const notes: Array<{ message: string; level: string }> = [];
		const agy = await loadAgyCommand();
		await agy("tasks", commandCtx(notes, true));
		await agy("artifacts", commandCtx(notes, true));
		expect(notes).toEqual([
			{ message: "no Antigravity conversation bound yet; run a turn first.", level: "warning" },
			{ message: "no Antigravity conversation bound yet; run a turn first.", level: "warning" },
		]);
	});
});

describe("/agy tasks tail", () => {
	it("/agy tasks tail <id> prints that task's log tail", async () => {
		bindSession();
		writeTaskLog(67, "first\nlast line of task 67\n");
		const notes: Array<{ message: string; level: string }> = [];
		const agy = await loadAgyCommand();
		await agy("tasks tail 67", commandCtx(notes, true));
		expect(notes).toEqual([{ message: "task #67 tail:\nfirst\nlast line of task 67\n", level: "info" }]);
	});

	it("/agy tasks tail <id> reports an id the conversation does not have", async () => {
		bindSession();
		writeTaskLog(67, "x\n");
		const notes: Array<{ message: string; level: string }> = [];
		const agy = await loadAgyCommand();
		await agy("tasks tail 3", commandCtx(notes, true));
		expect(notes).toEqual([{ message: "no task #3 in this conversation. /agy tasks lists them.", level: "warning" }]);
	});

	it("/agy tasks tail without a numeric id prints the usage", async () => {
		bindSession();
		const notes: Array<{ message: string; level: string }> = [];
		const agy = await loadAgyCommand();
		await agy("tasks tail", commandCtx(notes, true));
		expect(notes).toEqual([{ message: "usage: /agy tasks tail <id>. /agy tasks lists them.", level: "warning" }]);
	});
});
