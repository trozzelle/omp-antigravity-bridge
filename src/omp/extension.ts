// OMP wiring for the extension factory (extensions/index.ts). Each helper is
// one call site in that upstream file and a no-op (or pi's behaviour) under
// pi, so an upstream change near it merges without touching OMP logic.

import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { loadOmpSettingsLookup } from "./approval-settings.js";
import { initHost, isOmpHost } from "./host.js";
import { ModelChangeTracker } from "./model-change.js";
import { createOneshotProvider, type OneshotProviderDeps } from "./oneshot-driver.js";
import { loadTextWrap } from "./rows.js";
import { isWorkerRealm, type SessionKind } from "./runtime.js";

/** Detect the host, load the host's text wrap for textRows renders (both
 *  hosts), then (OMP) load OMP's settings registry: approval mode, policies
 *  and restricted folders, read synchronously later by the gate and the ACP
 *  permission policy. First thing the factory runs. */
export async function setupOmpHost(pi: ExtensionAPI): Promise<void> {
	initHost(pi);
	await loadTextWrap();
	if (isOmpHost()) await loadOmpSettingsLookup();
}

/** OMP raises no model_select to extensions: compare the model each prompt
 *  runs on with the one the session started on (see ModelChangeTracker) and
 *  report a switch as a "set". Nothing under pi, which has model_select. */
export function watchOmpModelChanges(
	pi: ExtensionAPI,
	onSwitch: (api: string | undefined, ctx: ExtensionContext) => void,
): void {
	if (!isOmpHost()) return;
	const modelChanges = new ModelChangeTracker();
	pi.on("session_start", (_event, ctx) => modelChanges.baseline(ctx.model));
	// /resume, /new and /fork raise session_switch (not session_start) and
	// restore the target session's model: a restore, never a switch.
	modelChanges.baselineOnSessionSwitch(pi);
	pi.on("before_agent_start", (_event, ctx) => {
		const switched = modelChanges.observe(ctx.model);
		if (switched) onSwitch(switched.api, ctx);
	});
}

/** OMP one-shot calls and /btw side turns get their own agy process
 *  (oneshot-driver.ts): on this session's stream-json driver they waited for
 *  its open turn and restarted its warm agy. Isolated home only: on the
 *  global config a throwaway agy would see other sessions' bridges.
 *  Undefined under pi, on ACP, or without an isolated home. */
export function createOmpOneshots(
	engine: "stream-json" | "acp",
	isolatedHome: boolean,
	deps: OneshotProviderDeps,
): ReturnType<typeof createOneshotProvider> | undefined {
	return isOmpHost() && engine === "stream-json" && isolatedHome ? createOneshotProvider(deps) : undefined;
}

/** The realm routing kind for this session. pi keeps upstream's routing: no
 *  kind, so ambiguous calls are refused. */
export function ompSessionKind(kind: SessionKind): SessionKind | undefined {
	return isOmpHost() ? kind : undefined;
}

/** OMP runs a worker-thread session's provider calls on the main thread, so
 *  an MCP listener started in a worker realm would never be called. */
export function isOmpWorkerRealm(): boolean {
	return isOmpHost() && isWorkerRealm();
}

/** /agy patch-cleanup under OMP: the legacy patch only ever targeted pi's own
 *  install. Says so and returns true (command handled); false under pi. */
export function ompRefusesPatchCleanup(ui: Pick<ExtensionUIContext, "notify"> | undefined): boolean {
	if (!isOmpHost()) return false;
	ui?.notify("patch-cleanup only applies to pi installs; nothing to clean under OMP.", "info");
	return true;
}
