// OMP one-shot calls and compaction summaries.
//
// OMP's compaction, branch-summary and title calls go through the session
// model with the live session id and no `cacheRetention: "none"`, and `/btw`
// side turns use session ids containing ":side:". Both must run in a
// throwaway agy conversation, never touching the session's binding.
// OMP also renders compaction summaries with its own templates
// (packages/agent/src/compaction/prompts/{compaction,handoff}-summary-context.md),
// which the digest must recognise to isolate and dedupe the summary.

import type { TranscriptContext } from "@earendil-works/pi-ai";
import { contextTools } from "./context.js";
import { isOmpHost } from "./host.js";

/** Leading lines of OMP's compaction and handoff summary messages. Branch
 *  summaries ("Branch-return summary:") are deliberately absent: they are
 *  not compactions. */
export const OMP_COMPACTION_PREFIXES: readonly string[] = [
	"Prior model work/tool state available.",
	"Context replaced. The <handoff>",
];

/** An OMP call outside the agent loop: no tools and no `getToolContext`
 *  option (the agent loop always passes one). */
export function isOmpOneshotCall(context: TranscriptContext, options: unknown): boolean {
	if (!isOmpHost() || contextTools(context).length > 0) return false;
	const getToolContext: unknown =
		typeof options === "object" && options !== null && "getToolContext" in options ? options.getToolContext : undefined;
	return typeof getToolContext !== "function";
}

/** OMP `/btw` side turn: session id `<id>:side:<hex>`. */
export function isSideTurnSession(sessionId: string | undefined): boolean {
	return isOmpHost() && typeof sessionId === "string" && sessionId.includes(":side:");
}

/** True for the text of an OMP compaction or handoff summary message. */
export function isOmpCompactionSummary(text: string): boolean {
	if (!isOmpHost()) return false;
	const head = text.trimStart();
	return OMP_COMPACTION_PREFIXES.some((prefix) => head.startsWith(prefix));
}

/** Body of an OMP handoff summary (between the `<handoff>` lines), or
 *  undefined for any other text. The intro sentence itself mentions
 *  `<handoff>`, so only tags on their own lines count. */
export function ompHandoffBody(text: string): string | undefined {
	if (!isOmpCompactionSummary(text)) return undefined;
	const open = text.indexOf("\n<handoff>\n");
	const close = text.lastIndexOf("\n</handoff>");
	if (open < 0 || close <= open) return undefined;
	return text.slice(open + "\n<handoff>\n".length, close).trim();
}

/** Calls that run in a throwaway agy conversation and never bind the
 *  session's: pi's compaction and branch summaries (`cacheRetention: "none"`),
 *  cache warming (`disableContinuation`), OMP's one-shot calls and side turns. */
export function isEphemeralCall(
	context: TranscriptContext,
	options: { cacheRetention?: string; disableContinuation?: boolean; sessionId?: string } | undefined,
): boolean {
	return (
		options?.cacheRetention === "none" ||
		options?.disableContinuation === true ||
		isOmpOneshotCall(context, options) ||
		isSideTurnSession(options?.sessionId)
	);
}
