// Provider park emits the dedicated tool under OMP; the approval tool never
// reaches agy's catalog (spec P8).
//
// Run: npx vitest run tests/omp/approval-park.test.ts

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { GATE_MARKER } from "../../src/approval-gate.js";
import { bridgedPiTools } from "../../src/bridge-catalog.js";
import type { DriverActivity, TurnDriver } from "../../src/driver-types.js";
import type { ApprovalDecision, ApprovalParkApi } from "../../src/mcp-server.js";
import { OMP_APPROVAL_TOOL_NAME } from "../../src/omp/approval-tool.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { ToolRoundTrips } from "../../src/provider.js";

afterEach(() => __setHostForTests(undefined));

function recordingDriver(): { driver: TurnDriver; pushed: DriverActivity[] } {
	const pushed: DriverActivity[] = [];
	const fake = {
		activeHandle: { pushExternal: (activity: DriverActivity) => void pushed.push(activity) },
		kickIdle: () => {},
	};
	return { driver: fake as unknown as TurnDriver, pushed };
}

function parkSpy(tickets: string[]): ApprovalParkApi & { decisions: Array<{ ticket: string } & ApprovalDecision> } {
	const pending = new Set(tickets);
	const decisions: Array<{ ticket: string } & ApprovalDecision> = [];
	return {
		decisions,
		has: (ticket) => pending.has(ticket),
		resolve: (ticket, decision) => {
			if (!pending.delete(ticket)) return false;
			decisions.push({ ticket, ...decision });
			return true;
		},
	};
}

function bridgeCall(activity: DriverActivity | undefined): { name: string; args: Record<string, unknown> } {
	assert.ok(activity?.type === "bridge_call");
	return { name: activity.name, args: activity.args };
}

test("under OMP a parked write emits the dedicated tool with a clean payload", () => {
	__setHostForTests("omp");
	const { driver, pushed } = recordingDriver();
	const rt = new ToolRoundTrips(driver);
	rt.approvalPark = parkSpy(["t1"]);
	rt.onApproval("t1", { toolCall: { name: "write_file", args: { TargetFile: "/w/gate.txt", Content: "hi" } } });
	assert.deepEqual(bridgeCall(pushed[0]), {
		name: OMP_APPROVAL_TOOL_NAME,
		args: { tool: "write_file", path: "/w/gate.txt", content: "hi", __agyTicket: "t1" },
	});
	rt.failAll("test end"); // clears the 480s park timer
});

test("under OMP a parked command carries command and cwd", () => {
	__setHostForTests("omp");
	const { driver, pushed } = recordingDriver();
	const rt = new ToolRoundTrips(driver);
	rt.approvalPark = parkSpy(["t2"]);
	rt.onApproval("t2", { toolCall: { name: "run_command", args: { CommandLine: "npm test", Cwd: "/w/pkg" } } });
	assert.deepEqual(bridgeCall(pushed[0]).args, { tool: "run_command", command: "npm test", cwd: "/w/pkg", __agyTicket: "t2" });
	rt.failAll("test end");
});

test("an OMP deny (error result) and an approval (success) reach agy as deny and allow", () => {
	__setHostForTests("omp");
	const { driver } = recordingDriver();
	const rt = new ToolRoundTrips(driver);
	const park = parkSpy(["t3", "t4"]);
	rt.approvalPark = park;
	rt.onApproval("t3", { toolCall: { name: "write_file", args: { TargetFile: "/w/a", Content: "x" } } });
	rt.onApproval("t4", { toolCall: { name: "write_file", args: { TargetFile: "/w/b", Content: "y" } } });
	assert.equal(rt.resolve("t3", `Tool call denied by user: ${OMP_APPROVAL_TOOL_NAME}`, true), true);
	assert.equal(rt.resolve("t4", "Approved by approval gate: write_file.", false), true);
	assert.deepEqual(park.decisions, [
		{ ticket: "t3", allow: false, reason: `Tool call denied by user: ${OMP_APPROVAL_TOOL_NAME}` },
		{ ticket: "t4", allow: true },
	]);
});

test("under pi the shadow toolUse is unchanged", () => {
	__setHostForTests("pi");
	const { driver, pushed } = recordingDriver();
	const rt = new ToolRoundTrips(driver);
	rt.approvalPark = parkSpy(["t5"]);
	rt.onApproval("t5", { toolCall: { name: "write_file", args: { TargetFile: "/w/gate.txt", Content: "hi" } } });
	const call = bridgeCall(pushed[0]);
	assert.equal(call.name, "write");
	assert.equal(call.args[GATE_MARKER], true);
	assert.equal(call.args.__agyTool, "write_file");
	rt.failAll("test end");
});

test("the approval tool is never bridged to agy", () => {
	__setHostForTests("omp");
	const tools = [
		{ name: OMP_APPROVAL_TOOL_NAME, sourceInfo: { source: "extension" } },
		{ name: "todo_write", sourceInfo: { source: "extension" } },
	];
	const bridged = bridgedPiTools(tools, [OMP_APPROVAL_TOOL_NAME, "todo_write"], "all", new Set());
	assert.deepEqual(bridged.map((t) => t.name), ["todo_write"]);
});
