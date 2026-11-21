// Realm-wide bridge runtime for OMP (oh-my-pi).
//
// OMP binds the extension factory again for every subagent session in the
// same JS realm: module state is shared, the custom-API registry is
// process-wide (the last registerProvider wins), and each subagent fires its
// own session_start / session_shutdown. Left alone, a subagent's factory call
// takes over the parent's provider calls, and its shutdown deletes the
// per-pid bridge dir, hook script and global MCP entry the parent still uses.
//
// One realm per JS realm (globalThis) owns what must exist exactly once:
//   - the session store (a single writer per sessions.json);
//   - one stable streamSimple that every factory call registers; it hands
//     each call to the session whose live session id is options.sessionId,
//     one-shot calls and side turns to that session's one-shot provider;
//   - one MCP listener. Each session serves its own tool catalog and
//     round-trips behind its own route token, which reaches its agy through
//     a per-session channel: ACP `mcpServers`, or the own entry of the
//     session's isolated stream-json home. The listener writes no add-dir
//     MCP config (agy reads MCP servers from its home config, not add-dirs:
//     CHANGELOG 1.4.10). The listener's own token rides only the per-realm
//     artifacts: the approval hook script and, on stream-json without an
//     isolated home, the global entry every session's agy shares. It
//     resolves to the session whose agy turn is open, and to nobody when
//     several are;
//   - removal of those per-realm artifacts when the last session leaves.
// Drivers, ToolRoundTrips and every pi-facing callback stay per session: both
// drivers serialize whole turn lifetimes and a parked turn stays open across
// the pi tool call, and the stranded-result sweep in ToolRoundTrips is
// registry-wide, so sharing either across sessions would stall concurrent
// subagents and hand one session's results to another.

import fs from "node:fs";
import path from "node:path";
import { isMainThread, threadId } from "node:worker_threads";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { logsDir } from "../config.js";
import { unregisterBridgeServer } from "../mcp-registration.js";
import { startMcpServer, type McpBridgeDeps, type McpServerHandle, type McpStartResult } from "../mcp-server.js";
import { SessionStore } from "../sessions.js";
import { isEphemeralCall } from "./oneshot.js";

const REALM_KEY = Symbol.for("omp-antigravity-bridge.runtime");

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

/** The approval hook script of this realm (one per realm, listener token
 *  embedded). Shared by the gate staging and the realm teardown. */
export function approvalHookScriptPath(): string {
	return path.join(logsDir(), `approval-hook-${pidTag()}.js`);
}

export type SessionKind = "main" | "sub";

/** `ctx.agent.kind` of an OMP extension context. pi has no `agent`; a context
 *  without one is a top-level session. */
export function sessionKindOf(ctx: unknown): SessionKind {
	if (typeof ctx !== "object" || ctx === null || !("agent" in ctx)) return "main";
	const agent = ctx.agent;
	return typeof agent === "object" && agent !== null && "kind" in agent && agent.kind === "sub" ? "sub" : "main";
}

/** The session manager's current session id. Read live: OMP keeps one
 *  extension runner across /new and /resume while the id changes. */
export function liveSessionId(sessionManager: unknown): string | undefined {
	if (typeof sessionManager !== "object" || sessionManager === null || !("getSessionId" in sessionManager)) return undefined;
	const read = sessionManager.getSessionId;
	if (typeof read !== "function") return undefined;
	try {
		const id: unknown = read.call(sessionManager);
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

export type BridgeStreamSimple = (
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/** What one session contributes to the realm. Every member is read live. */
export interface SessionPort {
	kind: SessionKind;
	/** Current session id; OMP passes it to providers as options.sessionId. */
	sessionId(): string | undefined;
	/** The session's own provider: its drivers, round-trips and pi callbacks. */
	streamSimple: BridgeStreamSimple;
	/** The session's provider for one-shot calls and side turns
	 *  (src/omp/oneshot-driver.ts), when it has one; else streamSimple. */
	oneshot?: BridgeStreamSimple;
	/** True while the session's agy turn is open (streaming or parked). */
	hasActiveTurn(): boolean;
	/** agy conversation of the session's current or last turn. */
	conversationId(): string | undefined;
}

/** A session's view of the bridge listener. `token` is the session's own
 *  route; `realmToken` is the listener token that per-realm artifacts (global
 *  entry, approval hook script) carry. Outside OMP they match. */
export interface BridgeEndpoint extends McpServerHandle {
	realmToken: string;
}

export interface BridgeAttachResult {
	ok: boolean;
	reason?: string;
	handle?: BridgeEndpoint;
	/** True for the session that started the listener. It stages the per-realm
	 *  artifacts: global entry, hook script, suppression heal. */
	first: boolean;
}

/** pi runs one session per process: its own listener is the realm's. */
export function piAttachResult(r: McpStartResult): BridgeAttachResult {
	return { ok: r.ok, reason: r.reason, first: true, handle: r.handle ? { ...r.handle, realmToken: r.handle.token } : undefined };
}

export interface RealmSession {
	/** Serve this session's tool catalog and round-trips on the realm
	 *  listener, starting it on first use. */
	attachBridge(deps: McpBridgeDeps, log: (event: string, data?: unknown) => void): Promise<BridgeAttachResult>;
	/** Leave the realm. The last session to leave closes the listener and
	 *  removes the per-realm artifacts. Idempotent. */
	leave(): Promise<void>;
}

export interface BridgeRealm {
	readonly store: SessionStore;
	/** Register this, not a per-session provider: OMP keeps only the last
	 *  registration per api, and every factory call registers again. */
	readonly streamSimple: BridgeStreamSimple;
	readonly liveSessions: number;
	join(port: SessionPort): RealmSession;
}

interface Member {
	port: SessionPort;
	bridge?: McpBridgeDeps;
	log?: (event: string, data?: unknown) => void;
	route?: { token: string; remove(): void };
}

const NO_TURN = "no active antigravity turn; the pi tool bridge only works while an antigravity model is streaming";
const SEVERAL_TURNS =
	"several antigravity sessions are streaming in this process and this request carries no session token";

class Realm implements BridgeRealm {
	#store: SessionStore | undefined;
	readonly #members = new Set<Member>();
	#starting: Promise<McpStartResult> | null = null;
	#server: McpServerHandle | null = null;
	#closing: Promise<void> = Promise.resolve();
	/** Last bridge log sink seen: the listener's close logs after every session left. */
	#lastLog: ((event: string, data?: unknown) => void) | undefined;

	get store(): SessionStore {
		this.#store ??= new SessionStore();
		return this.#store;
	}

	get liveSessions(): number {
		return this.#members.size;
	}

	readonly streamSimple: BridgeStreamSimple = (model, context, options) => {
		const member = this.#memberFor(options?.sessionId);
		if (!member) return refusedStream(model, "Antigravity bridge: no live session in this process");
		const { oneshot } = member.port;
		return (oneshot && isEphemeralCall(context, options) ? oneshot : member.port.streamSimple)(model, context, options);
	};

	join(port: SessionPort): RealmSession {
		const member: Member = { port };
		this.#members.add(member);
		let left = false;
		return {
			attachBridge: (deps, log) => this.#attach(member, deps, log),
			leave: async () => {
				if (left) return;
				left = true;
				member.route?.remove();
				this.#members.delete(member);
				if (this.#members.size === 0) await this.#teardown();
			},
		};
	}

	/** Test seam: drop every member and close the listener. */
	async dispose(): Promise<void> {
		this.#members.clear();
		await this.#teardown();
	}

	#memberFor(sessionId: string | undefined): Member | undefined {
		const members = [...this.#members];
		if (sessionId) {
			const exact = members.find((m) => m.port.sessionId() === sessionId);
			if (exact) return exact;
			// `/btw` side turns (`<id>:side:…`) and `/tan` clones (`<id>:tan:…`)
			// carry their owner's id as a prefix.
			const owner = members.find((m) => {
				const id = m.port.sessionId();
				return id !== undefined && sessionId.startsWith(`${id}:`);
			});
			if (owner) return owner;
		}
		// Unknown ids ride the main session: OMP advisors, worker-thread
		// subagents (their streams run on this thread) and pre-spawn judgments.
		return members.find((m) => m.port.kind === "main") ?? members[0];
	}

	async #attach(member: Member, deps: McpBridgeDeps, log: (event: string, data?: unknown) => void): Promise<BridgeAttachResult> {
		member.bridge = deps;
		member.log = log;
		const first = this.#starting === null;
		const starting = (this.#starting ??= this.#closing.then(() =>
			startMcpServer(this.#router, { log: (event, data) => this.#log(event, data), addDirConfig: false }),
		));
		const started = await starting;
		if (!started.ok || !started.handle) {
			if (this.#starting === starting) this.#starting = null;
			return { ok: false, reason: started.reason, first };
		}
		if (!this.#members.has(member)) return { ok: false, reason: "session ended before the bridge started", first };
		const server = started.handle;
		this.#server = server;
		member.route?.remove();
		const route = server.addRoute(deps);
		member.route = route;
		return {
			ok: true,
			first,
			handle: {
				port: server.port,
				token: route.token,
				realmToken: server.token,
				approvals: server.approvals,
				addRoute: server.addRoute,
				close: async () => route.remove(),
			},
		};
	}

	async #teardown(): Promise<void> {
		const starting = this.#starting;
		this.#starting = null;
		this.#server = null;
		if (!starting) return;
		this.#closing = (async () => {
			const started = await starting;
			// close() removes agy-mcp-<pidTag>: the add-dir with the staged hooks.
			await started.handle?.close();
			fs.rmSync(approvalHookScriptPath(), { force: true });
			// Writes only when this pid's entry exists (stream-json global mode).
			unregisterBridgeServer(process.pid);
		})().catch(() => {
			/* best effort, like upstream's per-session teardown */
		});
		await this.#closing;
	}

	/** Requests carrying the listener token (per-realm artifacts) belong to
	 *  whichever session's agy turn is open; with several open, only a
	 *  matching conversation id (approval payloads carry one) decides. With no
	 *  single owner the listener lists nothing rather than another session's
	 *  catalog. */
	readonly #router: McpBridgeDeps = {
		listTools: () => {
			const attached = [...this.#members].filter((m) => m.bridge);
			const target = this.#streaming() ?? (attached.length === 1 ? attached[0] : undefined);
			if (target?.bridge) return target.bridge.listTools();
			this.#log("list-tools-refused", { reason: this.#unattributed(), sessions: attached.length });
			return [];
		},
		onToolCall: (callId, name, args, signal) => {
			const target = this.#streaming();
			if (!target?.bridge) return Promise.reject(new Error(this.#unattributed()));
			return target.bridge.onToolCall(callId, name, args, signal);
		},
		onApproval: (ticket, payload) => {
			const conversationId = typeof payload.conversationId === "string" ? payload.conversationId : undefined;
			const onApproval = this.#streaming(conversationId)?.bridge?.onApproval;
			if (onApproval) {
				onApproval(ticket, payload);
				return;
			}
			this.#server?.approvals.resolve(ticket, { allow: false, reason: `approval gate: ${this.#unattributed()}` });
		},
	};

	#streaming(conversationId?: string): Member | undefined {
		const open = [...this.#members].filter((m) => m.bridge && m.port.hasActiveTurn());
		if (open.length === 1) return open[0];
		if (conversationId === undefined) return undefined;
		const owners = open.filter((m) => m.port.conversationId() === conversationId);
		return owners.length === 1 ? owners[0] : undefined;
	}

	#unattributed(): string {
		const open = [...this.#members].filter((m) => m.bridge && m.port.hasActiveTurn());
		return open.length > 1 ? SEVERAL_TURNS : NO_TURN;
	}

	#log(event: string, data?: unknown): void {
		const members = [...this.#members];
		const sink = (members.find((m) => m.port.kind === "main" && m.log) ?? members.find((m) => m.log))?.log ?? this.#lastLog;
		this.#lastLog = sink;
		sink?.(event, data);
	}
}

function refusedStream(model: Model<Api>, message: string): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const error: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "error",
		errorMessage: message,
		timestamp: Date.now(),
	};
	stream.push({ type: "error", reason: "error", error });
	stream.end();
	return stream;
}

/** This realm's bridge runtime, created on first use. */
export function ompRealm(): BridgeRealm {
	const existing: unknown = Reflect.get(globalThis, REALM_KEY);
	if (existing instanceof Realm) return existing;
	const realm = new Realm();
	Reflect.set(globalThis, REALM_KEY, realm);
	return realm;
}

/** Drop the realm (closing its listener) so each test starts clean. */
export async function __resetRealmForTests(): Promise<void> {
	const existing: unknown = Reflect.get(globalThis, REALM_KEY);
	Reflect.deleteProperty(globalThis, REALM_KEY);
	if (existing instanceof Realm) await existing.dispose();
}
