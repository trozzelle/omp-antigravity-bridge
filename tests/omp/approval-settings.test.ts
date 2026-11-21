// OMP approval settings -> gate on/off and ACP permission policy (spec P8).
//
// Run: npx vitest run tests/omp/approval-settings.test.ts

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { OMP_APPROVAL_TOOL_NAME } from "../../src/omp/approval-tool.js";
import {
	acpPermissionPolicy,
	effectiveGateMode,
	loadOmpSettingsLookup,
	ompGateWanted,
	readOmpApprovalSettings,
	resolveOmpGateMode,
	type OmpApprovalSettings,
	type OmpSettingLookup,
} from "../../src/omp/approval-settings.js";
import { __setHostForTests } from "../../src/omp/host.js";

const scope = { kind: "omp-settings" };
const ompPi = { pi: { settings: scope } };

function fakeLookup(values: Record<string, unknown>, seenScopes: unknown[] = []): OmpSettingLookup {
	return (id) =>
		id in values
			? {
					get: (s: unknown) => {
						seenScopes.push(s);
						return values[id];
					},
				}
			: undefined;
}

const yolo: OmpApprovalSettings = { approvalMode: "yolo", policies: {}, restrictedFolders: [] };

beforeEach(() => __setHostForTests("omp"));
afterEach(async () => {
	__setHostForTests(undefined);
	// Reset the module-cached registry lookup.
	await loadOmpSettingsLookup(async () => {
		throw new Error("no registry");
	});
});

test("reads mode, normalized policies and restricted folders from pi.pi.settings", () => {
	const seen: unknown[] = [];
	const lookup = fakeLookup(
		{
			"tools.approvalMode": "always-ask",
			"tools.approval": { bash: " Prompt ", write: "allow", junk: "maybe", edit: 3 },
			"tools.restrictedFolders": ["~/secrets", "  ", 3],
		},
		seen,
	);
	assert.deepEqual(readOmpApprovalSettings(ompPi, lookup), {
		approvalMode: "always-ask",
		policies: { bash: "prompt", write: "allow" },
		restrictedFolders: ["~/secrets"],
	});
	assert.ok(seen.length >= 3);
	assert.ok(seen.every((s) => s === scope));
});

test("an unrecognized approval mode reads as yolo, like OMP's own resolver", () => {
	assert.equal(readOmpApprovalSettings(ompPi, fakeLookup({ "tools.approvalMode": "sometimes" }))?.approvalMode, "yolo");
});

test("unreadable settings return undefined instead of throwing", () => {
	const full = fakeLookup({ "tools.approvalMode": "yolo" });
	assert.equal(readOmpApprovalSettings({}, full), undefined, "pi-shaped API has no pi.pi.settings");
	assert.equal(readOmpApprovalSettings(ompPi, undefined), undefined, "no registry");
	assert.equal(readOmpApprovalSettings(ompPi, fakeLookup({})), undefined, "registry without tools.approvalMode");
	const throwing: OmpSettingLookup = () => ({
		get: () => {
			throw new Error("boom");
		},
	});
	assert.equal(readOmpApprovalSettings(ompPi, throwing), undefined);
});

test("the registry loader resolves to nothing outside OMP and caches an injected registry", async () => {
	// Node test run: @oh-my-pi/pi-coding-agent is not installed.
	assert.equal(await loadOmpSettingsLookup(), undefined);
	assert.equal(readOmpApprovalSettings(ompPi), undefined);

	const loaded = await loadOmpSettingsLookup(async () => ({
		lookup: fakeLookup({ "tools.approvalMode": "write" }),
	}));
	assert.ok(loaded);
	assert.equal(readOmpApprovalSettings(ompPi)?.approvalMode, "write");
});

test("gate wanted: any prompting mode, a prompt/deny policy on a gated tool, or a restricted folder", () => {
	assert.equal(ompGateWanted(undefined), true, "unreadable settings fail closed");
	assert.equal(ompGateWanted(yolo), false);
	assert.equal(ompGateWanted({ ...yolo, approvalMode: "always-ask" }), true);
	assert.equal(ompGateWanted({ ...yolo, approvalMode: "always-ask-cached" }), true);
	assert.equal(ompGateWanted({ ...yolo, approvalMode: "write" }), true);
	assert.equal(ompGateWanted({ ...yolo, policies: { bash: "prompt" } }), true);
	assert.equal(ompGateWanted({ ...yolo, policies: { edit: "deny" } }), true);
	assert.equal(ompGateWanted({ ...yolo, policies: { [OMP_APPROVAL_TOOL_NAME]: "deny" } }), true);
	assert.equal(ompGateWanted({ ...yolo, policies: { bash: "allow", read: "deny" } }), false);
	assert.equal(ompGateWanted({ ...yolo, restrictedFolders: ["/secrets"] }), true);
});

test("OMP gate mode: off stays off, forced shapes become the dedicated tool, auto follows the settings", () => {
	assert.equal(resolveOmpGateMode("off", { ...yolo, approvalMode: "always-ask" }), "off");
	assert.equal(resolveOmpGateMode("shadow", yolo), "dedicated");
	assert.equal(resolveOmpGateMode("dedicated", yolo), "dedicated");
	assert.equal(resolveOmpGateMode("auto", yolo), "off");
	assert.equal(resolveOmpGateMode("auto", { ...yolo, approvalMode: "always-ask" }), "dedicated");
	assert.equal(resolveOmpGateMode("auto", undefined), "dedicated");
});

test("effectiveGateMode never yields shadow under OMP and keeps the upstream shape under pi", async () => {
	await loadOmpSettingsLookup(async () => ({ lookup: fakeLookup({ "tools.approvalMode": "yolo" }) }));
	assert.equal(effectiveGateMode(ompPi, "auto"), "off");
	assert.equal(effectiveGateMode(ompPi, "shadow"), "dedicated");
	await loadOmpSettingsLookup(async () => ({ lookup: fakeLookup({ "tools.approvalMode": "always-ask" }) }));
	assert.equal(effectiveGateMode(ompPi, "auto"), "dedicated");

	__setHostForTests("pi");
	assert.equal(effectiveGateMode({}, "shadow"), "shadow");
	assert.equal(effectiveGateMode({}, "off"), "off");
});

test("ACP permission policy: allow auto-answers, deny/ask open the dialog, inherit follows OMP settings", () => {
	let reads = 0;
	const read = (s: OmpApprovalSettings | undefined) => () => {
		reads += 1;
		return s;
	};
	assert.equal(acpPermissionPolicy("allow", read(undefined)), "auto");
	assert.equal(acpPermissionPolicy("deny", read(yolo)), "deny");
	assert.equal(acpPermissionPolicy("ask", read(yolo)), "deny");
	assert.equal(reads, 0, "explicit modes never consult OMP settings");
	assert.equal(acpPermissionPolicy("inherit", read(yolo)), "auto");
	assert.equal(acpPermissionPolicy("inherit", read({ ...yolo, approvalMode: "always-ask" })), "deny");
	assert.equal(acpPermissionPolicy("inherit", read({ ...yolo, restrictedFolders: ["/x"] })), "deny");
	assert.equal(acpPermissionPolicy("inherit", read(undefined)), "deny");
});
