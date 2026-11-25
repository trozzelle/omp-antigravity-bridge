// Display of ACP native tool steps (agy-native-event, agy-poll-run) on both hosts.
//
// pi draws custom session entries: registerEntryRenderer + appendEntry.
// OMP has no registerEntryRenderer and never draws appendEntry rows, so
// there the same cards travel as display-only custom messages:
// registerMessageRenderer + sendMessage({ display, excludeFromContext }).
// OMP sends custom messages to the model as developer messages whatever
// excludeFromContext says, so a context filter drops the cards again; OMP
// persists them and redraws them on resume. Both paths share one renderer
// per card, so a card looks the same on either host.
//
// A card sent mid-reply on OMP queues as steering and lands below the
// finished answer. acp.nativeSteps "inline" (the OMP default) skips the
// cards and returns nativeStepTrace() text for the reply's thinking stream.

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import type { AgyConfig } from "../config.js";
import type { NativeSteps } from "./config.js";
import { POLL_TOOL_NAME, type NativeDisplayEvent } from "../provider.js";
import type { PollRunData } from "../poll-fold.js";
import { isOmpHost } from "./host.js";

export const NATIVE_EVENT_CARD = "agy-native-event";
export const POLL_RUN_CARD = "agy-poll-run";

/** Where native steps show: pi always draws cards; OMP follows
 *  acp.nativeSteps, inline by default. */
export function nativeStepMode(config: Pick<AgyConfig, "acp">): NativeSteps {
	return isOmpHost() ? (config.acp.nativeSteps ?? "inline") : "cards";
}

/** The slice of the host theme the cards use (pi Theme and OMP Theme both fit). */
export interface CardTheme {
	fg(color: string, text: string): string;
}

export interface CardRenderOptions {
	expanded: boolean;
}

export type CardEntryRenderer = (entry: { data?: unknown }, options: CardRenderOptions, theme: CardTheme) => Component | undefined;
export type CardMessageRenderer = (message: { details?: unknown }, options: CardRenderOptions, theme: CardTheme) => Component | undefined;

/** Display-only custom message: drawn and saved, never sent to the model. */
export interface CardMessage {
	customType: string;
	content: string;
	display: true;
	details: unknown;
	excludeFromContext: true;
}

/** The ExtensionAPI members the cards need. registerEntryRenderer is absent on OMP. */
export interface CardHost {
	registerEntryRenderer?(customType: string, renderer: CardEntryRenderer): void;
	registerMessageRenderer(customType: string, renderer: CardMessageRenderer): void;
	sendMessage(message: CardMessage): void;
	appendEntry(customType: string, data?: unknown): void;
}

function isNativeDisplayEvent(value: unknown): value is NativeDisplayEvent {
	return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "status" in value && typeof value.status === "string";
}

function isPollRunData(value: unknown): value is PollRunData {
	return typeof value === "object" && value !== null && "target" in value && typeof value.target === "string" && "count" in value && typeof value.count === "number";
}

const firstLine = (value: string | undefined): string | undefined => value?.split(/\r?\n/, 1)[0].trim() || undefined;

/** Terminal-safe card text. Line endings fold to "\n" (a "\r" would send the
 *  cursor home and let the padding overwrite the line: `CARD_TEST\r\n` drew
 *  blank). Remaining C0 controls (ESC included) and DEL are dropped; tab and
 *  newline stay. Trailing newlines carry no content. */
export function sanitizeCardText(value: string): string {
	return value
		.replace(/\r\n?/g, "\n")
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
		.replace(/\n+$/, "");
}

const sanitizeOptional = (value: string | undefined): string | undefined => (value === undefined ? undefined : sanitizeCardText(value));

/** Native Antigravity tool step: status mark, tool name, most specific detail; expanded adds path, diff and output. */
export function renderNativeEventCard(data: unknown, expanded: boolean, theme: CardTheme): Text {
	const raw = isNativeDisplayEvent(data) ? data : undefined;
	const event = raw && { ...raw, command: sanitizeOptional(raw.command), output: sanitizeOptional(raw.output), diff: sanitizeOptional(raw.diff) };
	// Collapsed detail: most-specific signal wins (path, command, agy's own
	// display text). The name is NOT a fallback here - it rendered "ls ls"
	// duplication whenever the event carried neither path nor command.
	const detail = event?.path ? path.basename(event.path) : firstLine(event?.command) ?? firstLine(event?.output);
	const status = event?.status === "failed" ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const lines = [`${status} ${theme.fg("toolTitle", event?.name ?? "Antigravity")}${detail ? ` ${theme.fg("muted", detail.slice(0, 160))}` : ""}`];
	if (expanded) {
		if (event?.path) lines.push(theme.fg("dim", event.path));
		if (event?.diff) {
			for (const line of event.diff.split("\n")) {
				const color = line.startsWith("+") ? "toolDiffAdded" : line.startsWith("-") ? "toolDiffRemoved" : "toolDiffContext";
				lines.push(theme.fg(color, line));
			}
		}
		if (event?.output && (!event.diff || event.status === "failed")) {
			for (const line of event.output.split("\n")) lines.push(theme.fg("toolOutput", line));
		}
	}
	return new Text(lines.join("\n"), 0, 0);
}

/** Collapsed poll burst: one ♊︎-marked counted line instead of one card per poll. */
export function renderPollRunCard(data: unknown, expanded: boolean, theme: CardTheme): Text {
	const run = isPollRunData(data) ? data : undefined;
	const count = run?.count ?? 0;
	const label = `Poll ${run?.target ?? "bridge call"} (x${count}${run?.state === "failed" ? ", failed" : ""})`;
	const lines = [`♊︎ ${theme.fg("toolTitle", POLL_TOOL_NAME)} ${theme.fg("muted", label)}`];
	if (expanded && run) {
		const time = (iso: string): string => new Date(iso).toLocaleTimeString();
		lines.push(theme.fg("dim", `${count} ${count === 1 ? "poll" : "polls"}, ${time(run.firstAt)} → ${time(run.lastAt)}`));
	}
	return new Text(lines.join("\n"), 0, 0);
}

/** Plain-text line stored as the message content; shown where the renderer does not run. */
export function nativeEventSummary(event: NativeDisplayEvent): string {
	const detail = event.path ?? firstLine(event.command)?.slice(0, 160);
	return `[${NATIVE_EVENT_CARD}] ${event.status === "failed" ? "✗" : "✓"} ${event.name}${detail ? ` ${detail}` : ""}`;
}

/** A backtick run longer than any inside `text` and at least `min` long
 *  (CommonMark: such a fence cannot be closed by the text itself). */
function backtickFence(text: string, min: number): string {
	const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
	return "`".repeat(Math.max(min, longest + 1));
}

/** Inline code span that survives backticks inside `text`, padded with
 *  spaces when the text holds any. */
function codeSpan(text: string): string {
	const fence = backtickFence(text, 1);
	return text.includes("`") ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

/** One native step as a markdown paragraph for the reply's thinking stream:
 *  status mark, tool name and the card's collapsed detail; a failure adds
 *  the error's first line, an edit its diff in a fenced block. */
export function nativeStepTrace(event: NativeDisplayEvent): string {
	const command = sanitizeOptional(event.command);
	const output = sanitizeOptional(event.output);
	const failed = event.status === "failed";
	// The card's collapsed detail; a failure's output is the error, shown after.
	const detail = event.path ? path.basename(event.path) : firstLine(command) ?? (failed ? undefined : firstLine(output));
	let line = `${failed ? "✗" : "✓"} ${event.name}${detail ? ` ${codeSpan(sanitizeCardText(detail).slice(0, 160))}` : ""}`;
	const error = failed ? firstLine(output) : undefined;
	if (error) line += `: ${error.slice(0, 200)}`;
	const diff = sanitizeOptional(event.diff);
	if (!diff) return `\n${line}\n\n`;
	const fence = backtickFence(diff, 3);
	return `\n${line}\n${fence}diff\n${diff}\n${fence}\n\n`;
}

export function pollRunSummary(run: PollRunData): string {
	return `[${POLL_RUN_CARD}] ${POLL_TOOL_NAME} → ${run.target} (x${run.count}${run.state === "failed" ? ", failed" : ""})`;
}

/** Register both card renderers on the current host. */
export function registerCardRenderers(pi: CardHost): void {
	if (isOmpHost()) {
		pi.registerMessageRenderer(NATIVE_EVENT_CARD, (message, { expanded }, theme) => renderNativeEventCard(message.details, expanded, theme));
		pi.registerMessageRenderer(POLL_RUN_CARD, (message, { expanded }, theme) => renderPollRunCard(message.details, expanded, theme));
		return;
	}
	if (typeof pi.registerEntryRenderer !== "function") return;
	pi.registerEntryRenderer(NATIVE_EVENT_CARD, (entry, { expanded }, theme) => renderNativeEventCard(entry.data, expanded, theme));
	pi.registerEntryRenderer(POLL_RUN_CARD, (entry, { expanded }, theme) => renderPollRunCard(entry.data, expanded, theme));
}

/** Emit one card: a custom entry on pi, a display-only excluded message on OMP. */
export function emitDisplayCard(pi: CardHost, customType: string, data: unknown, summary: string): void {
	if (!isOmpHost()) {
		pi.appendEntry(customType, data);
		return;
	}
	pi.sendMessage({ customType, content: summary, display: true, details: data, excludeFromContext: true });
}

/** The ExtensionAPI slice the context filter needs. */
export type CardContextHost = Pick<ExtensionAPI, "on">;

function isCardMessage(message: unknown): boolean {
	if (typeof message !== "object" || message === null) return false;
	const { role, customType } = message as { role?: unknown; customType?: unknown };
	return role === "custom" && (customType === NATIVE_EVENT_CARD || customType === POLL_RUN_CARD);
}

/** OMP: keep card messages, including cards saved by earlier sessions, out
 *  of the model's context. pi stores cards as entries, never as messages. */
export function registerCardContextFilter(pi: CardContextHost): void {
	if (!isOmpHost()) return;
	pi.on("context", (event) => (event.messages.some(isCardMessage) ? { messages: event.messages.filter((m) => !isCardMessage(m)) } : undefined));
}
