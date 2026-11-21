import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { __setHostForTests } from "../../src/omp/host.js";

let agentDir: string;
const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
const prevAgyBin = process.env.AGY_BIN;

beforeEach(() => {
	agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-load-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.AGY_BIN = path.join(agentDir, "no-such-agy");
	fs.mkdirSync(path.join(agentDir, "antigravity-bridge"), { recursive: true });
	fs.writeFileSync(path.join(agentDir, "antigravity-bridge", "config.json"), JSON.stringify({ engine: "acp" }));
	__setHostForTests(undefined);
});
afterEach(() => {
	__setHostForTests(undefined);
	if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
	if (prevAgyBin === undefined) delete process.env.AGY_BIN;
	else process.env.AGY_BIN = prevAgyBin;
	fs.rmSync(agentDir, { recursive: true, force: true });
});

/** OMP-shaped ExtensionAPI: every method a recording no-op, `pi.settings`
 *  present, and no `registerEntryRenderer` (OMP 19.1 lacks it). */
function ompShapedPi(): { api: ExtensionAPI; calls: Map<string, unknown[][]> } {
	const calls = new Map<string, unknown[][]>();
	const api: ExtensionAPI = new Proxy<ExtensionAPI>(Object.create(null), {
		get(_t, prop) {
			if (prop === "pi") return { settings: {} };
			if (prop === "registerEntryRenderer" || prop === "then" || typeof prop === "symbol") return undefined;
			return (...args: unknown[]) => {
				const list = calls.get(prop) ?? [];
				list.push(args);
				calls.set(prop, list);
				if (prop === "getAllTools" || prop === "getActiveTools" || prop === "getCommands") return [];
				return undefined;
			};
		},
		has(_t, prop) {
			return prop === "pi" || (prop !== "registerEntryRenderer" && typeof prop === "string");
		},
	});
	return { api, calls };
}

describe("extension load on an OMP-shaped host", () => {
	it("registers the antigravity provider on the ACP engine without registerEntryRenderer", async () => {
		const { default: factory } = await import("../../extensions/index.js");
		const { api, calls } = ompShapedPi();
		await factory(api);
		const providers = calls.get("registerProvider") ?? [];
		expect(providers.map((args) => args[0])).toContain("antigravity");
	});
});
