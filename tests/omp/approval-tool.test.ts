// Dedicated approval tool for agy native calls under OMP (spec P8).
//
// Run: npx vitest run tests/omp/approval-tool.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import type { GateAskMode } from "../../src/config.js";
import { type OmpSettingLookup, readOmpApprovalSettings } from "../../src/omp/approval-settings.js";
import { __setHostForTests } from "../../src/omp/host.js";
import {
	createOmpApprovalTool,
	OMP_APPROVAL_TOOL_NAME,
	type ThemeLike,
} from "../../src/omp/approval-tool.js";

const theme: ThemeLike = { fg: (_color, text) => text, bold: (text) => text };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type HostPolicies = NonNullable<ReturnType<typeof readOmpApprovalSettings>>["policies"];

function makeTool(
	opts: { askMode?: () => GateAskMode; tickets?: string[]; cwd?: string; hostPolicies?: () => HostPolicies | undefined } = {},
) {
	const tickets = new Set(opts.tickets ?? ["t-live"]);
	return createOmpApprovalTool({
		cwd: opts.cwd ?? "/work",
		askMode: opts.askMode ?? (() => "inherit"),
		hostPolicies: opts.hostPolicies,
		verifyTicket: (ticket) => tickets.has(ticket),
	});
}

const writeArgs = { tool: "write_file", path: "/work/gate.txt", content: "hi\n", __agyTicket: "t-live" };
const execArgs = { tool: "run_command", command: "npm test\nnpm run lint", cwd: "/work/pkg", __agyTicket: "t-live" };
const editArgs = {
	tool: "replace_file_content",
	path: "/work/a.ts",
	edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
	__agyTicket: "t-live",
};

test("the model-facing schema carries exactly the approval payload, top-level", () => {
	const tool = makeTool();
	assert.equal(tool.name, OMP_APPROVAL_TOOL_NAME);
	// Discoverable extension tools leave the advertised set; the agent loop
	// could not resolve the provider-emitted call.
	assert.equal(tool.loadMode, "essential");
	const schema: unknown = JSON.parse(JSON.stringify(tool.parameters));
	assert.ok(isRecord(schema));
	assert.ok(isRecord(schema.properties));
	assert.deepEqual(Object.keys(schema.properties).sort(), [
		"__agyTicket",
		"command",
		"content",
		"cwd",
		"edits",
		"path",
		"tool",
	]);
	assert.ok(Array.isArray(schema.required));
	assert.deepEqual([...schema.required].sort(), ["__agyTicket", "tool"]);
	assert.equal(schema.additionalProperties, false);
});

test("tier is exec for run_command, write for file tools; approvals.mode maps onto the OMP policy", () => {
	assert.equal(makeTool({ askMode: () => "inherit" }).approval(execArgs), "exec");
	assert.equal(makeTool({ askMode: () => "inherit" }).approval(writeArgs), "write");
	assert.equal(makeTool({ askMode: () => "inherit" }).approval(editArgs), "write");
	assert.deepEqual(makeTool({ askMode: () => "allow" }).approval(writeArgs), { tier: "write", policy: "allow" });
	assert.deepEqual(makeTool({ askMode: () => "ask" }).approval(execArgs), { tier: "exec", policy: "prompt" });
	assert.deepEqual(makeTool({ askMode: () => "deny" }).approval(writeArgs), {
		tier: "write",
		policy: "deny",
		reason: "approvals.mode is deny",
	});
});

/** hostPolicies as extensions/index.ts wires it: read live from OMP's settings. */
function policiesFromOmp(approval: Record<string, unknown>): () => HostPolicies | undefined {
	const values: Record<string, unknown> = { "tools.approvalMode": "yolo", "tools.approval": approval };
	const lookup: OmpSettingLookup = (id) => (id in values ? { get: () => values[id] } : undefined);
	return () => readOmpApprovalSettings({ pi: { settings: {} } }, lookup)?.policies;
}

test("inherit mirrors the user's bash/write/edit policy onto the matching agy action", () => {
	__setHostForTests("omp");
	try {
		// yolo + bash: deny must still deny agy's run_command.
		const denyBash = makeTool({ hostPolicies: policiesFromOmp({ bash: "deny" }) });
		assert.deepEqual(denyBash.approval(execArgs), { tier: "exec", policy: "deny", reason: "tools.approval.bash" });
		assert.equal(denyBash.approval(writeArgs), "write");

		// write mode + write: deny denies a file write, edit: prompt prompts a replacement.
		const fileTool = makeTool({ hostPolicies: policiesFromOmp({ write: "deny", edit: "prompt" }) });
		assert.deepEqual(fileTool.approval(writeArgs), { tier: "write", policy: "deny", reason: "tools.approval.write" });
		assert.deepEqual(fileTool.approval(editArgs), { tier: "write", policy: "prompt", reason: "tools.approval.edit" });
		assert.equal(fileTool.approval(execArgs), "exec");
	} finally {
		__setHostForTests(undefined);
	}
});

test("an explicit policy on the approval tool itself outranks the mirrored builtin policy", () => {
	const hostPolicies = () => ({ bash: "deny", write: "deny", [OMP_APPROVAL_TOOL_NAME]: "allow" }) as const;
	const tool = makeTool({ hostPolicies });
	assert.equal(tool.approval(execArgs), "exec");
	assert.equal(tool.approval(writeArgs), "write");
});

test("approvals.mode allow, ask and deny are not overridden by the mirrored policies", () => {
	const hostPolicies = () => ({ bash: "deny" }) as const;
	assert.deepEqual(makeTool({ askMode: () => "allow", hostPolicies }).approval(execArgs), { tier: "exec", policy: "allow" });
	assert.deepEqual(makeTool({ askMode: () => "ask", hostPolicies }).approval(execArgs), { tier: "exec", policy: "prompt" });
});

test("approvals.mode is read per call, so a config change applies without re-registering", () => {
	let mode: GateAskMode = "inherit";
	const tool = makeTool({ askMode: () => mode });
	assert.equal(tool.approval(writeArgs), "write");
	mode = "deny";
	assert.deepEqual(tool.approval(writeArgs), { tier: "write", policy: "deny", reason: "approvals.mode is deny" });
});

test("approval prompt details name the native tool and its command or file, never the ticket", () => {
	const tool = makeTool();
	assert.deepEqual(tool.formatApprovalDetails(writeArgs), [
		"Antigravity native tool: write_file",
		"File: /work/gate.txt",
		"Content:\nhi\n",
	]);
	assert.deepEqual(tool.formatApprovalDetails(execArgs), [
		"Antigravity native tool: run_command",
		"Command: npm test\nnpm run lint",
		"Cwd: /work/pkg",
	]);
	assert.deepEqual(tool.formatApprovalDetails(editArgs), [
		"Antigravity native tool: replace_file_content",
		"File: /work/a.ts",
		"Diff:",
		"-const a = 1;",
		"+const a = 2;",
	]);
	for (const args of [writeArgs, execArgs, editArgs]) {
		assert.ok(!tool.formatApprovalDetails(args).join("\n").includes("t-live"));
	}
});

test("long write content and long edit diffs are shortened in the prompt", () => {
	const tool = makeTool();
	const longWrite = tool.formatApprovalDetails({ ...writeArgs, content: "x".repeat(700) });
	assert.equal(longWrite[2], `Content:\n${"x".repeat(600)}… (100 more chars)`);
	const edits = Array.from({ length: 20 }, (_, i) => ({ oldText: `old ${i}`, newText: `new ${i}` }));
	const diff = tool.formatApprovalDetails({ ...editArgs, edits });
	// 20 edits x (header + one removed + one added line) = 60 lines, capped at 40.
	assert.equal(diff.length, 3 + 40 + 1);
	assert.equal(diff[3], "@@ edit 1/20");
	assert.equal(diff.at(-1), "… (20 more lines)");
});

test("cache targets are absolute, symlink-resolved file keys so grants and restricted folders match OMP's own", () => {
	const real = fs.mkdtempSync(path.join(os.tmpdir(), "agy-approval-real-"));
	const link = path.join(os.tmpdir(), `agy-approval-link-${process.pid}-${Date.now()}`);
	fs.symlinkSync(real, link);
	try {
		const tool = makeTool({ cwd: link });
		const realKey = fs.realpathSync(real);
		// Missing intermediate dirs still resolve through the existing ancestor.
		assert.deepEqual(tool.approvalCacheTargets({ ...writeArgs, path: path.join(link, "new", "f.txt") }), [
			path.join(realKey, "new", "f.txt"),
		]);
		// Relative paths resolve against the session cwd.
		assert.deepEqual(tool.approvalCacheTargets({ ...editArgs, path: "rel.ts" }), [path.join(realKey, "rel.ts")]);
		// Commands have no file target: OMP then matches restricted folders on args.cwd.
		assert.equal(tool.approvalCacheTargets(execArgs), undefined);
		assert.equal(tool.approvalCacheTargets({ ...writeArgs, path: "   " }), undefined);
	} finally {
		fs.rmSync(link, { force: true });
		fs.rmSync(real, { recursive: true, force: true });
	}
});

test("the tool row shows the native tool and target, never the ticket fields", () => {
	const tool = makeTool();
	const write = tool.renderCall(writeArgs, theme).render(200).join("\n");
	assert.match(write, /Antigravity write_file/);
	assert.match(write, /\/work\/gate\.txt/);
	const exec = tool.renderCall(execArgs, theme).render(200).join("\n");
	assert.match(exec, /Antigravity run_command/);
	assert.match(exec, /npm test/);
	assert.doesNotMatch(exec, /npm run lint/);
	for (const text of [write, exec]) {
		assert.ok(!text.includes("t-live"));
		assert.ok(!text.includes("__agy"));
	}
	// Streaming partial args render without throwing.
	assert.match(tool.renderCall({}, theme).render(200).join("\n"), /Antigravity approval/);
});

test("execute approves a live ticket without asking again, and refuses forged or stale ones", async () => {
	const tool = makeTool({ tickets: ["t-live"] });
	const result = await tool.execute("call-1", writeArgs, undefined);
	const first = result.content[0];
	assert.ok(first?.type === "text");
	assert.match(first.text, /^Approved by approval gate: write_file\./);
	assert.deepEqual(result.details, { gate: "allow", native: "write_file" });

	await assert.rejects(tool.execute("call-2", { ...writeArgs, __agyTicket: "forged" }, undefined), /unrecognized or stale approval ticket/);
	await assert.rejects(tool.execute("call-3", { tool: "write_file", path: "/work/x" }, undefined), /unrecognized or stale approval ticket/);
	const aborted = new AbortController();
	aborted.abort();
	await assert.rejects(tool.execute("call-4", writeArgs, aborted.signal), /aborted before a decision/);
});
