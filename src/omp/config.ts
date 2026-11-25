// OMP config knobs, kept out of src/config.ts so that upstream file carries
// only one-line hooks (fewer sync conflicts): the nativeSteps key and the
// "inherit" approvals mode.

import type { AcpConfig, GateAskMode } from "../config.js";
import { isOmpHost } from "./host.js";

/** OMP only: where ACP native tool steps (agy's own read_file, run_command,
 *  edits) show. "inline" (default): one trace line per step (plus edit
 *  diffs) in the reply's thinking stream, in the order the steps ran.
 *  "cards": separate display cards; OMP queues a custom message sent
 *  mid-reply as steering, so they land below the finished answer. pi always
 *  draws cards (the key is absent there). */
export type NativeSteps = "inline" | "cards";

declare module "../config.js" {
	interface AcpConfig {
		/** OMP only (absent under pi): native step display, see NativeSteps.
		 *  Env AGY_NATIVE_STEPS wins over the file. Takes effect on the next
		 *  native step. */
		nativeSteps?: NativeSteps;
	}
}

/** approvals.mode values only OMP gives meaning to. "inherit" (OMP
 *  default): no bridge policy, OMP's tools.approvalMode / tools.approval
 *  decide. Under pi "inherit" reads as "ask". Under OMP "ask" forces an OMP
 *  approval prompt (headless = deny, fail-closed). */
export type OmpGateAskMode = "inherit";

/** Default approvals.mode: OMP defers to its own approval mode; pi keeps
 *  the bridge confirm. */
export function defaultGateAskMode(): GateAskMode {
	return isOmpHost() ? "inherit" : "ask";
}

/** Narrow a raw nativeSteps value (file, env, picker) to the known set,
 *  case-insensitive; anything else is undefined. Shared by load and save so
 *  the two can never drift. */
export function toNativeSteps(raw: unknown): NativeSteps | undefined {
	const value = typeof raw === "string" ? raw.toLowerCase() : undefined;
	return value === "inline" || value === "cards" ? value : undefined;
}

/** The OMP keys loadConfig adds to `acp`; none under pi. */
export function loadOmpAcp(fileAcp: Partial<AcpConfig>): Partial<AcpConfig> {
	if (!isOmpHost()) return {};
	return { nativeSteps: toNativeSteps(process.env.AGY_NATIVE_STEPS ?? fileAcp.nativeSteps) ?? "inline" };
}

/** The OMP keys saveConfig persists in `acp`: only a value the user chose,
 *  normalized (an unset key keeps tracking the default, junk is dropped);
 *  none under pi. */
export function saveOmpAcp(patchAcp: Partial<AcpConfig> | undefined, fileAcp: Partial<AcpConfig>): Partial<AcpConfig> {
	const nativeSteps = isOmpHost() ? toNativeSteps(patchAcp?.nativeSteps ?? fileAcp.nativeSteps) : undefined;
	return nativeSteps ? { nativeSteps } : {};
}
