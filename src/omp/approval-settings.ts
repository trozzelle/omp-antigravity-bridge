// OMP approval settings for the agy approval gate (spec P8).
//
// Under OMP the user's approval posture lives in OMP settings:
// tools.approvalMode, tools.approval (per-tool allow|deny|prompt) and
// tools.restrictedFolders. They are read through the settings registry
// (`lookup(id)?.get(pi.pi.settings)`, docs/extensions.md "Runtime setting
// overrides"). The registry module exists only inside OMP: it is loaded
// once with a guarded dynamic import and injected into the readers, so pi
// and Node tests run without it.
//
// Run: npx vitest run tests/omp/approval-settings.test.ts

import { detectPermissionGateExtensions, resolveGateMode } from "../approval-detect.js";
import type { GateAskMode, GateMode } from "../config.js";
import { OMP_APPROVAL_TOOL_NAME } from "./approval-tool.js";
import { isOmpHost } from "./host.js";

export type OmpApprovalMode = "always-ask" | "always-ask-cached" | "write" | "yolo";
export type OmpApprovalPolicy = "allow" | "deny" | "prompt";

export interface OmpApprovalSettings {
	approvalMode: OmpApprovalMode;
	policies: Readonly<Record<string, OmpApprovalPolicy>>;
	restrictedFolders: readonly string[];
}

/** The slice of an OMP setting handle (config/registry.ts Setting) used here. */
export interface OmpSettingHandle {
	get(scope: unknown): unknown;
}

export type OmpSettingLookup = (id: string) => OmpSettingHandle | undefined;

const APPROVAL_MODES: readonly OmpApprovalMode[] = ["always-ask", "always-ask-cached", "write", "yolo"];

/** Tools whose prompt/deny policy means "the user gates mutations": the
 *  dedicated tool itself plus the builtins agy's native tools mirror. */
const GATE_RELEVANT_TOOLS: readonly string[] = [OMP_APPROVAL_TOOL_NAME, "bash", "write", "edit"];

let registryLookup: OmpSettingLookup | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSettingHandle(value: unknown): value is OmpSettingHandle {
	return isRecord(value) && typeof value.get === "function";
}

/**
 * Load OMP's settings registry once and cache its lookup for the readers.
 * The default importer MUST stay a string-literal dynamic import: OMP
 * rewrites only literal specifiers in extension sources
 * (legacy-pi-compat.ts). Resolves to undefined (and clears the cache) when
 * the module is absent (pi, Node tests) or has no `lookup`.
 */
export async function loadOmpSettingsLookup(
	importRegistry: () => Promise<unknown> = () => import("@oh-my-pi/pi-coding-agent/config/registry"),
): Promise<OmpSettingLookup | undefined> {
	registryLookup = undefined;
	try {
		const mod = await importRegistry();
		if (isRecord(mod) && typeof mod.lookup === "function") {
			const lookupFn = mod.lookup;
			registryLookup = (id) => {
				const handle: unknown = lookupFn(id);
				return isSettingHandle(handle) ? handle : undefined;
			};
		}
	} catch {
		// Not running under OMP: no registry, readers return undefined.
	}
	return registryLookup;
}

function ompSettingsScope(pi: unknown): object | undefined {
	if (!isRecord(pi)) return undefined;
	const inner = pi.pi;
	if (!isRecord(inner)) return undefined;
	const settings = inner.settings;
	return typeof settings === "object" && settings !== null ? settings : undefined;
}

function normalizePolicy(value: unknown): OmpApprovalPolicy | undefined {
	if (typeof value !== "string") return undefined;
	const lowered = value.trim().toLowerCase();
	return lowered === "allow" || lowered === "deny" || lowered === "prompt" ? lowered : undefined;
}

/**
 * The user's OMP approval posture, or undefined when it cannot be read
 * (not OMP, registry missing, setting ids drifted, handle threw). Callers
 * treat undefined as "gate wanted" (fail closed). An unrecognized mode
 * reads as yolo, matching OMP's resolveApprovalFromContext.
 */
export function readOmpApprovalSettings(
	pi: unknown,
	lookup: OmpSettingLookup | undefined = registryLookup,
): OmpApprovalSettings | undefined {
	const scope = ompSettingsScope(pi);
	if (scope === undefined || lookup === undefined) return undefined;
	try {
		const modeHandle = lookup("tools.approvalMode");
		if (!modeHandle) return undefined;
		const rawMode = modeHandle.get(scope);
		const approvalMode = APPROVAL_MODES.find((mode) => mode === rawMode) ?? "yolo";
		const policies: Record<string, OmpApprovalPolicy> = {};
		const rawPolicies = lookup("tools.approval")?.get(scope);
		if (isRecord(rawPolicies)) {
			for (const [tool, value] of Object.entries(rawPolicies)) {
				const policy = normalizePolicy(value);
				if (policy) policies[tool] = policy;
			}
		}
		const rawFolders = lookup("tools.restrictedFolders")?.get(scope);
		const restrictedFolders = Array.isArray(rawFolders)
			? rawFolders.filter((folder): folder is string => typeof folder === "string" && folder.trim() !== "")
			: [];
		return { approvalMode, policies, restrictedFolders };
	} catch {
		return undefined;
	}
}

/** gateMode auto under OMP: on unless the user runs plain yolo with no
 *  restrictive policy and no restricted folder. Unreadable -> on. */
export function ompGateWanted(settings: OmpApprovalSettings | undefined): boolean {
	if (!settings) return true;
	if (settings.approvalMode !== "yolo") return true;
	if (settings.restrictedFolders.length > 0) return true;
	return GATE_RELEVANT_TOOLS.some((tool) => {
		const policy = settings.policies[tool];
		return policy === "prompt" || policy === "deny";
	});
}

/** Gate shape under OMP: never shadow (OMP builtins are never replaced);
 *  shadow and dedicated both mean the dedicated tool. */
export function resolveOmpGateMode(
	gateMode: GateMode,
	settings: OmpApprovalSettings | undefined,
): "dedicated" | "off" {
	if (gateMode === "off") return "off";
	if (gateMode === "shadow" || gateMode === "dedicated") return "dedicated";
	return ompGateWanted(settings) ? "dedicated" : "off";
}

/** The one gate-mode entry point for extensions/index.ts. Under pi this is
 *  exactly the upstream resolveGateMode(gateMode, detection). */
export function effectiveGateMode(pi: unknown, gateMode: GateMode): "shadow" | "dedicated" | "off" {
	if (isOmpHost()) return resolveOmpGateMode(gateMode, readOmpApprovalSettings(pi));
	return resolveGateMode(gateMode, detectPermissionGateExtensions());
}

/** ACP session/request_permission standing policy (non-skipPermissions
 *  turns). allow -> auto; deny/ask -> "deny" (dialog or fail-closed);
 *  inherit (OMP only) -> auto exactly when OMP would not gate. */
export function acpPermissionPolicy(
	askMode: GateAskMode,
	readSettings: () => OmpApprovalSettings | undefined,
): "auto" | "deny" {
	if (askMode === "allow") return "auto";
	if (askMode !== "inherit") return "deny";
	return ompGateWanted(readSettings()) ? "deny" : "auto";
}
