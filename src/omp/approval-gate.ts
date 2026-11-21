// OMP side of the approval-gate wiring at session start (spec P8).
//
// One hook script and one gate group serve every session in the realm, with
// the listener token embedded: the session that started the realm listener
// stages them and the realm's last session removes them (src/omp/runtime.ts).
// A later session never rewrites them, which could hand a live agy's hook a
// truncated script. OMP's builtins are never shadowed: every session
// registers the one approval tool, which OMP's own approval gate decides on
// before execute().

import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { hookScriptSource, stageGateHooks } from "../approval-hook.js";
import { loadConfig } from "../config.js";
import { bridgeMcpConfigDir } from "../mcp-server.js";
import { readOmpApprovalSettings } from "./approval-settings.js";
import { createOmpApprovalTool, OMP_APPROVAL_TOOL_NAME } from "./approval-tool.js";
import { approvalHookScriptPath, type BridgeEndpoint } from "../runtime.js";

export interface OmpApprovalGateOptions {
	/** This session started the realm listener (BridgeAttachResult.first). */
	first: boolean;
	handle: BridgeEndpoint;
	/** Effective gate mode, for the log. */
	mode: string;
	parkBudgetMs: number;
	log: (event: string, data: unknown, level: "debug" | "info") => void;
}

export function wireOmpApprovalGate(pi: ExtensionAPI, opts: OmpApprovalGateOptions): void {
	const { handle } = opts;
	if (opts.first) {
		// 0600: the listener token is embedded (peer review 2026-09-07).
		const scriptPath = approvalHookScriptPath();
		fs.mkdirSync(path.dirname(scriptPath), { recursive: true, mode: 0o700 });
		fs.writeFileSync(
			scriptPath,
			hookScriptSource({ port: handle.port, token: handle.realmToken, deadlineMs: opts.parkBudgetMs }),
			{ mode: 0o600 },
		);
		// Private per-pid staging (issue #5 isolation): the bridge add-dir only
		// this realm's agy processes receive.
		const staged = stageGateHooks(bridgeMcpConfigDir(), {
			port: handle.port,
			token: handle.realmToken,
			scriptPath,
			parkBudgetMs: opts.parkBudgetMs,
		});
		opts.log("approval-staged", { mode: opts.mode, script: scriptPath, ...staged }, staged.wrote ? "info" : "debug");
	}
	pi.registerTool(
		createOmpApprovalTool({
			cwd: process.cwd(),
			askMode: () => loadConfig().approvals.mode,
			hostPolicies: () => readOmpApprovalSettings(pi)?.policies,
			verifyTicket: (t) => handle.approvals.has(t),
		}),
	);
	opts.log("approval-tool-registered", { tool: OMP_APPROVAL_TOOL_NAME }, "info");
}
