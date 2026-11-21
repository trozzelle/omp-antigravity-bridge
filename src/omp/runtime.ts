// OMP helpers for the realm runtime (src/runtime.ts).
//
// OMP binds the extension factory again for every subagent session in the
// same JS realm, and runs some subagents in worker threads (same pid,
// separate realm and module state). Upstream's realm runtime covers the
// shared store, the stable dispatcher, the shared listener and refcounted
// teardown; this module adds what only OMP needs:
//   - session kinds, so calls with an unknown session id ride the main
//     session instead of being refused;
//   - a per-realm file tag, so a worker-thread realm never shares or deletes
//     the main thread's per-pid bridge dir and hook script.
// The one-shot routing hook (SessionPort.oneshot) lives in src/runtime.ts.

import { isMainThread, threadId } from "node:worker_threads";

interface ThreadInfo {
	isMainThread: boolean;
	threadId: number;
}

let threadOverride: ThreadInfo | undefined;

/** Tag for per-pid file names: the pid on the main thread, `<pid>-t<threadId>`
 *  inside a worker thread (same pid, separate realm, separate module state). */
export function pidTag(): string {
	const thread = threadOverride ?? { isMainThread, threadId };
	return thread.isMainThread ? String(process.pid) : `${process.pid}-t${thread.threadId}`;
}

/** True inside a worker thread. OMP runs a worker session's custom-API stream
 *  on the main thread, so a bridge endpoint started here is never called. */
export function isWorkerRealm(): boolean {
	return !(threadOverride ?? { isMainThread, threadId }).isMainThread;
}

export function __setThreadForTests(info: ThreadInfo | undefined): void {
	threadOverride = info;
}

export type SessionKind = "main" | "sub";

/** `ctx.agent.kind` of an OMP extension context. pi has no `agent`; a context
 *  without one is a top-level session. */
export function sessionKindOf(ctx: unknown): SessionKind {
	if (typeof ctx !== "object" || ctx === null || !("agent" in ctx)) return "main";
	const agent = ctx.agent;
	return typeof agent === "object" && agent !== null && "kind" in agent && agent.kind === "sub" ? "sub" : "main";
}
