// OMP context normalization. OMP hands providers `context.systemPrompt:
// string[]` and `context.tools` instead of pi's leading system message, and
// maps custom/extension messages to role `developer` where pi uses `user`.
// The provider reads its context through these helpers; under pi every
// helper returns exactly what the upstream code read before.

import { getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import { isOmpHost } from "./host.js";

/** Replaces OMP's "MUST read skill://<name>" line: agy loads skills through
 *  the bridge's activate_skill tool, not OMP's internal URLs. */
export const OMP_SKILLS_INTRO =
	"Skills: when a skill below matches the task, call the `activate_skill` tool with its name first; it returns the skill's instructions.";

/** "user" always; "developer" too under OMP (custom messages, hook
 *  messages, background wakes). */
export function isUserLikeRole(role: unknown): boolean {
	return role === "user" || (role === "developer" && isOmpHost());
}

/** Leading lines of OMP's compaction and handoff summary messages. Branch
 *  summaries are not compactions; see OMP_BRANCH_SUMMARY_PREFIX. */
export const OMP_COMPACTION_PREFIXES: readonly string[] = [
	"Prior model work/tool state available.",
	"Context replaced. The <handoff>",
];

/** Leading line of OMP's branch-return summary message. */
export const OMP_BRANCH_SUMMARY_PREFIX = "Branch-return summary:";

/** True for the text of an OMP compaction or handoff summary message. */
export function isOmpCompactionSummary(text: string): boolean {
	if (!isOmpHost()) return false;
	const head = text.trimStart();
	return OMP_COMPACTION_PREFIXES.some((prefix) => head.startsWith(prefix));
}

/** First `<tag>` … `</tag>` block whose tags sit alone on their lines, the way
 *  OMP's templates render them. */
function lineBlock(text: string, tag: string): string | undefined {
	return new RegExp(`^<${tag}>\\n[\\s\\S]*?\\n</${tag}>$`, "m").exec(text)?.[0];
}

/** First line of OMP's default system prompt template
 *  (packages/coding-agent/src/prompts/system/system-prompt.md). Only a prompt
 *  built from that template is reduced; custom prompts pass through. */
export const OMP_DEFAULT_PROMPT_IDENTITY = "You are omp's trusted coding assistant.";

export interface OmpPromptOptions {
	/** The bridge offers `activate_skill` this session; without it the skills
	 *  list would point agy at a tool it does not have. */
	skillsTool: boolean;
}

/** Whether a `context.systemPrompt[]` element is OMP's rendered
 *  `project-prompt.md` (`<project-context>` … `</critical>`, then the session's
 *  append text). */
function isProjectPrompt(part: string): boolean {
	return part.trimStart().startsWith("<project-context>");
}

/** The parts of OMP's rendered project prompt agy can act on: `<repo-rules>`,
 *  `<dir-context>`, `<workspace-roots>`, and the append-prompt text
 *  (`--append-system-prompt`, APPEND_SYSTEM.md) that follows `</critical>`.
 *  The workstation, workspace tree and tool-bound notes are dropped. */
function projectPromptParts(part: string): { blocks: string[]; append: string } {
	const repoRules = lineBlock(part, "repo-rules");
	// AGENTS.md text lives inside repo-rules; search everything else outside it.
	const rest = repoRules ? part.replace(repoRules, "") : part;
	const close = /^<\/project-context>$/m.exec(rest);
	const body = close ? rest.slice(0, close.index) : rest;
	const afterClose = close ? rest.slice(close.index + close[0].length) : "";
	const critical = /^<critical>\n[\s\S]*?\n<\/critical>$/m.exec(afterClose);
	const append = critical ? afterClose.slice(critical.index + critical[0].length).trim() : "";
	const blocks = [repoRules, lineBlock(body, "dir-context"), lineBlock(body, "workspace-roots")].filter(
		(piece): piece is string => piece !== undefined,
	);
	return { blocks, append };
}

/** The part of OMP's system prompt agy can act on. OMP renders
 *  `systemPrompt[]` as the default template body, eval-prelude guidance
 *  blocks, the project prompt, and (subagents) the subagent prompt. From the
 *  default body this keeps the always-apply rules (`<generic-rules>`) and, when
 *  `activate_skill` is offered, the skills list introduced for it; from the
 *  project prompt, see projectPromptParts (the append text follows the
 *  rules). OMP's tool and protocol instructions and the eval guidance are
 *  dropped. Every element after the project prompt
 *  (a subagent's role, context, working-tree rules and completion contract) is
 *  agy's brief and passes through unchanged. Any other prompt (a custom prompt
 *  or a user SYSTEM.md template) is returned joined and otherwise unchanged. */
export function ompSystemPromptText(systemPrompt: string | readonly string[] | undefined, opts: OmpPromptOptions): string {
	if (systemPrompt === undefined) return "";
	const parts = typeof systemPrompt === "string" ? [systemPrompt] : systemPrompt;
	const body = parts[0] ?? "";
	if (!body.trimStart().startsWith(OMP_DEFAULT_PROMPT_IDENTITY)) return parts.join("\n\n");
	const projectIdx = parts.findIndex((part, i) => i > 0 && isProjectPrompt(part));
	const afterBody = projectIdx < 0 ? parts.slice(1) : parts.slice(projectIdx + 1);
	const project = projectIdx < 0 ? { blocks: [], append: "" } : projectPromptParts(parts[projectIdx] ?? "");
	const skills = opts.skillsTool ? lineBlock(body, "skills") : undefined;
	const genericRules = lineBlock(body, "generic-rules");
	return [...project.blocks, skills && `${OMP_SKILLS_INTRO}\n${skills}`, genericRules, project.append, ...afterBody]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join("\n\n");
}

/** OMP's raw `context.systemPrompt`, when it has one of the accepted shapes. */
function rawSystemPrompt(context: TranscriptContext): string | string[] | undefined {
	const raw: unknown = "systemPrompt" in context ? context.systemPrompt : undefined;
	if (typeof raw === "string") return raw;
	if (Array.isArray(raw) && raw.every((part): part is string => typeof part === "string")) return raw;
	return undefined;
}

/** System prompt for agy, or undefined when there is none: pi's transcript
 *  system message, else (OMP) the reduced `context.systemPrompt`. Under OMP a
 *  default-template prompt with nothing agy can use reduces to "" (still a
 *  system prompt: the tool-priority note ships); a missing or empty
 *  `context.systemPrompt` is undefined, as before. */
export function contextSystemPrompt(context: TranscriptContext, opts: OmpPromptOptions): string | undefined {
	const fromTranscript = getCurrentSystemPrompt(context.messages);
	if (fromTranscript || !isOmpHost()) return fromTranscript || undefined;
	const raw = rawSystemPrompt(context);
	const joined = raw === undefined ? "" : typeof raw === "string" ? raw : raw.join("\n\n");
	if (!joined.trim()) return undefined;
	return ompSystemPromptText(raw, opts);
}

/** Tools declared for this call: pi's transcript tool state, else (OMP)
 *  `context.tools`. Only names are read by the provider. */
export function contextTools(context: TranscriptContext): Array<{ name: string }> {
	const fromTranscript = getCurrentTools(context.messages);
	if (fromTranscript.length > 0 || !isOmpHost()) return fromTranscript;
	const raw: unknown = "tools" in context ? context.tools : undefined;
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((tool: unknown) =>
		typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string" ? [{ name: tool.name }] : [],
	);
}

/** Text blocks of one message's content, joined and trimmed. */
function messageText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block: unknown) =>
			typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n")
		.trim();
}

/** True for a user-like message OMP generated as a summary (compaction,
 *  handoff or branch return) rather than one the user or a hook sent. */
function isSummaryMessage(message: unknown): boolean {
	const text = messageText(contentOf(message)).trimStart();
	return isOmpCompactionSummary(text) || (isOmpHost() && text.startsWith(OMP_BRANCH_SUMMARY_PREFIX));
}

/** Index where the trailing run of user-like messages starts (OMP often
 *  appends developer notices after the user's message, or sends a developer
 *  message alone); `messages.length` when the last message is not user-like.
 *  The run stops at an OMP summary message: after `/compact` the transcript
 *  is `[summary, user prompt]` and only the prompt belongs to this turn (the
 *  summary ships through the digest). A tail made only of summaries is the
 *  whole run, so it still has something to send. */
export function trailingUserLikeStart(messages: readonly unknown[]): number {
	const scan = (stopAtSummary: boolean): number => {
		let start = messages.length;
		while (start > 0) {
			const m = messages[start - 1];
			if (typeof m !== "object" || m === null || !("role" in m) || !isUserLikeRole(m.role)) break;
			if (stopAtSummary && isSummaryMessage(m)) break;
			start--;
		}
		return start;
	};
	const start = scan(true);
	return start === messages.length ? scan(false) : start;
}

function trailingUserLike(messages: readonly unknown[]): unknown[] {
	return messages.slice(trailingUserLikeStart(messages));
}

function contentOf(message: unknown): unknown {
	return typeof message === "object" && message !== null && "content" in message ? message.content : undefined;
}

/** OMP: the prompt is the text of the trailing user/developer run, one
 *  message per paragraph. Null when that run carries no text. */
export function ompUserPrompt(messages: readonly unknown[]): string | null {
	return (
		trailingUserLike(messages)
			.map((m) => messageText(contentOf(m)))
			.filter((text) => text.length > 0)
			.join("\n\n") || null
	);
}

/** OMP: image blocks across the trailing user/developer run. */
export function ompUserImages(messages: readonly unknown[]): Array<{ data: string; mimeType: string }> {
	return trailingUserLike(messages).flatMap((m) => {
		const content = contentOf(m);
		if (!Array.isArray(content)) return [];
		return content.flatMap((block: unknown) =>
			typeof block === "object" &&
			block !== null &&
			"type" in block &&
			block.type === "image" &&
			"data" in block &&
			typeof block.data === "string" &&
			"mimeType" in block &&
			typeof block.mimeType === "string"
				? [{ data: block.data, mimeType: block.mimeType }]
				: [],
		);
	});
}
