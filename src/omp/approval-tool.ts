// Dedicated approval tool for agy NATIVE tool calls under OMP (spec P8).
//
// Under OMP the bridge never shadows bash/write/edit: a same-name extension
// tool replaces OMP's builtin for the whole session. Instead one net-new
// tool carries each parked agy approval through OMP's own approval gate:
//   - `approval`: tier exec for run_command, write otherwise, plus the
//     policy approvals.mode asks for (inherit = the user's own bash/write/
//     edit policy for the matching action, else OMP's mode decides);
//   - `formatApprovalDetails`: the prompt body (native tool, command/file,
//     short diff);
//   - `approvalCacheTargets`: absolute keys, so always-ask-cached grants
//     and tools.restrictedFolders apply to agy writes.
// OMP resolves approval BEFORE execute(), so execute only checks the ticket:
// no second confirm. A deny, block or headless prompt throws, which becomes
// an error tool result that the provider maps to an agy deny.
//
// Run: npx vitest run tests/omp/approval-tool.test.ts

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { GateAskMode } from "../config.js";

/** Tool name the provider emits for an approval round-trip under OMP. */
export const OMP_APPROVAL_TOOL_NAME = "antigravity_native_approval";

/** The only gated agy tool that runs code; everything else writes files. */
const EXEC_NATIVE_TOOL = "run_command";
const MAX_CONTENT_CHARS = 600;
const MAX_DIFF_LINES = 40;
const MAX_ROW_DETAIL_CHARS = 200;

export type OmpToolTier = "read" | "write" | "exec";
type OmpApprovalPolicy = "allow" | "deny" | "prompt";

/** OMP `ToolApprovalDecision` (agent/src/types.ts): a bare tier, or a tier
 *  plus a policy that outranks the approval mode. */
export type OmpApprovalDecision =
	| OmpToolTier
	| { tier: OmpToolTier; policy: OmpApprovalPolicy; reason?: string };

/** The theme surface the row renderer uses. OMP passes an options object
 *  that also answers the Theme API (wrapper.ts renderOptionsWithTheme). */
export type ThemeLike = Pick<Theme, "fg" | "bold">;

export interface OmpApprovalDetails {
	gate: "allow";
	native: string;
}

export interface OmpApprovalToolDeps {
	/** Session cwd: relative target paths resolve against it. */
	cwd: string;
	/** approvals.mode, read per call so config changes apply live. */
	askMode: () => GateAskMode;
	/** The user's tools.approval policies, read per call. OMP looks a policy
	 *  up only under the called tool's own name, so under `inherit` the
	 *  bash/write/edit policies are mirrored onto the matching agy action. */
	hostPolicies?: () => Readonly<Record<string, OmpApprovalPolicy>> | undefined;
	/** True while the ticket is parked (mcp-server handle.approvals.has). */
	verifyTicket: (ticket: string) => boolean;
}

const OMP_APPROVAL_PARAMETERS = Type.Object(
	{
		tool: Type.String({ description: "Antigravity native tool awaiting approval." }),
		command: Type.Optional(Type.String()),
		cwd: Type.Optional(Type.String()),
		path: Type.Optional(Type.String()),
		content: Type.Optional(Type.String()),
		edits: Type.Optional(Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() }))),
		__agyTicket: Type.String({ description: "Internal approval ticket. Never fabricate." }),
	},
	{ additionalProperties: false },
);

/** What `pi.registerTool` receives. Structurally a pi ToolDefinition; the
 *  extra keys are OMP ToolDefinition fields that pi ignores. */
export interface OmpApprovalToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: typeof OMP_APPROVAL_PARAMETERS;
	loadMode: "essential";
	approval: (args: unknown) => OmpApprovalDecision;
	formatApprovalDetails: (args: unknown) => string[];
	approvalCacheTargets: (args: unknown) => readonly string[] | undefined;
	renderCall: (args: unknown, theme: ThemeLike) => Text;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
	) => Promise<AgentToolResult<OmpApprovalDetails>>;
}

interface ApprovalArgs {
	tool: string;
	command?: string;
	cwd?: string;
	path?: string;
	content?: string;
	edits: Array<{ oldText: string; newText: string }>;
	ticket: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function readArgs(args: unknown): ApprovalArgs {
	const r = isRecord(args) ? args : {};
	const edits = Array.isArray(r.edits)
		? r.edits.filter(isRecord).map((e) => ({ oldText: str(e.oldText) ?? "", newText: str(e.newText) ?? "" }))
		: [];
	return {
		tool: str(r.tool) ?? "",
		command: str(r.command),
		cwd: str(r.cwd),
		path: str(r.path),
		content: str(r.content),
		edits,
		ticket: str(r.__agyTicket) ?? "",
	};
}

/** The OMP builtin an agy action stands in for: its tools.approval policy
 *  is the one the user wrote for that kind of action. */
function mirroredBuiltin(a: ApprovalArgs): "bash" | "edit" | "write" {
	if (a.tool === EXEC_NATIVE_TOOL) return "bash";
	return a.edits.length > 0 ? "edit" : "write";
}

function ompApprovalDecision(
	args: unknown,
	mode: GateAskMode,
	hostPolicies: OmpApprovalToolDeps["hostPolicies"],
): OmpApprovalDecision {
	const a = readArgs(args);
	const tier: OmpToolTier = a.tool === EXEC_NATIVE_TOOL ? "exec" : "write";
	switch (mode) {
		case "deny":
			return { tier, policy: "deny", reason: "approvals.mode is deny" };
		case "allow":
			return { tier, policy: "allow" };
		case "ask":
			return { tier, policy: "prompt" };
		case "inherit": {
			// A policy set for the approval tool itself is what OMP applies; leave it.
			const policies = hostPolicies?.();
			if (!policies || policies[OMP_APPROVAL_TOOL_NAME] !== undefined) return tier;
			const builtin = mirroredBuiltin(a);
			const policy = policies[builtin];
			return policy ? { tier, policy, reason: `tools.approval.${builtin}` } : tier;
		}
	}
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max)}… (${text.length - max} more chars)`;
}

function shortDiff(edits: ApprovalArgs["edits"]): string[] {
	const out: string[] = [];
	edits.forEach((edit, i) => {
		if (edits.length > 1) out.push(`@@ edit ${i + 1}/${edits.length}`);
		if (edit.oldText !== "") for (const line of edit.oldText.split("\n")) out.push(`-${line}`);
		if (edit.newText !== "") for (const line of edit.newText.split("\n")) out.push(`+${line}`);
	});
	if (out.length <= MAX_DIFF_LINES) return out;
	return [...out.slice(0, MAX_DIFF_LINES), `… (${out.length - MAX_DIFF_LINES} more lines)`];
}

function formatOmpApprovalDetails(args: unknown): string[] {
	const a = readArgs(args);
	const lines = [`Antigravity native tool: ${a.tool || "(unknown)"}`];
	if (a.tool === EXEC_NATIVE_TOOL) {
		lines.push(`Command: ${a.command ?? "(missing)"}`);
		if (a.cwd) lines.push(`Cwd: ${a.cwd}`);
		return lines;
	}
	lines.push(`File: ${a.path ?? "(missing)"}`);
	if (a.edits.length > 0) lines.push("Diff:", ...shortDiff(a.edits));
	else if (a.content !== undefined) lines.push(`Content:\n${truncate(a.content, MAX_CONTENT_CHARS)}`);
	return lines;
}

/** realpath of the longest existing ancestor, with the missing tail
 *  re-appended: OMP keys grants the same way (pi-utils resolveEquivalentPath
 *  with throughMissing), so /tmp and /private/tmp name one grant. */
function realpathThroughMissing(target: string): string {
	try {
		return fs.realpathSync(target);
	} catch {
		// Missing target: walk up below.
	}
	const missing: string[] = [];
	let current = target;
	for (;;) {
		const parent = path.dirname(current);
		if (parent === current) return target;
		missing.unshift(path.basename(current));
		current = parent;
		try {
			return path.join(fs.realpathSync(current), ...missing);
		} catch {
			// Keep walking: a higher ancestor may exist.
		}
	}
}

/** Grant/restriction key for a file target, matching OMP's
 *  approvalTargetKey for local paths (tools/approval-targets.ts). */
export function approvalTargetKey(cwd: string, raw: string): string | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const expanded =
		trimmed === "~" ? os.homedir() : trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : raw;
	const resolved = realpathThroughMissing(path.resolve(cwd, expanded));
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function ompApprovalCacheTargets(args: unknown, cwd: string): readonly string[] | undefined {
	const a = readArgs(args);
	if (a.tool === EXEC_NATIVE_TOOL || a.path === undefined) return undefined;
	const key = approvalTargetKey(cwd, a.path);
	return key === undefined ? undefined : [key];
}

function renderOmpApprovalCall(args: unknown, theme: ThemeLike): Text {
	const a = readArgs(args);
	const detail = a.tool === EXEC_NATIVE_TOOL ? a.command?.split(/\r?\n/, 1)[0]?.trim() : a.path;
	let text = theme.fg("toolTitle", theme.bold(`Antigravity ${a.tool || "approval"}`));
	if (detail) text += ` ${theme.fg("muted", detail.slice(0, MAX_ROW_DETAIL_CHARS))}`;
	return new Text(text, 0, 0);
}

/** The bridge_call payload the provider pushes for a parked approval. */
export function ompApprovalToolCall(
	native: string,
	input: Record<string, unknown>,
	ticket: string,
): { name: string; args: Record<string, unknown> } {
	return { name: OMP_APPROVAL_TOOL_NAME, args: { tool: native, ...input, __agyTicket: ticket } };
}

export function createOmpApprovalTool(deps: OmpApprovalToolDeps): OmpApprovalToolDefinition {
	return {
		name: OMP_APPROVAL_TOOL_NAME,
		label: "Antigravity approval",
		description:
			"Internal approval round-trip for Antigravity's own tool calls. The bridge issues these calls itself; never call this tool.",
		parameters: OMP_APPROVAL_PARAMETERS,
		loadMode: "essential",
		approval: (args) => ompApprovalDecision(args, deps.askMode(), deps.hostPolicies),
		formatApprovalDetails: formatOmpApprovalDetails,
		approvalCacheTargets: (args) => ompApprovalCacheTargets(args, deps.cwd),
		renderCall: (args, theme) => renderOmpApprovalCall(args, theme),
		execute: async (_toolCallId, params, signal) => {
			const a = readArgs(params);
			const native = a.tool || "unknown";
			// Ticket binding: only calls the provider parked carry a live ticket.
			// Anything else was forged by a model (or the park is gone): fail
			// closed, whatever OMP's approval said.
			if (!a.ticket || !deps.verifyTicket(a.ticket)) {
				throw new Error(`approval gate: unrecognized or stale approval ticket; refusing to decide (${native}).`);
			}
			if (signal?.aborted) {
				throw new Error(`approval gate aborted before a decision was reached (${native}).`);
			}
			return {
				content: [
					{
						type: "text",
						text: `Approved by approval gate: ${native}. No local execution happened; the tool runs in the Antigravity agent loop.`,
					},
				],
				details: { gate: "allow", native },
			};
		},
	};
}
