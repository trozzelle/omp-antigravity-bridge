// Display-only ACP cards (agy-native-event, agy-poll-run) on both hosts.
//
// pi draws custom session entries: registerEntryRenderer + appendEntry.
// OMP has no registerEntryRenderer and never draws appendEntry rows, so
// there the same cards travel as display-only custom messages:
// registerMessageRenderer + sendMessage({ display, excludeFromContext }).
// excludeFromContext keeps them out of the model's context; OMP persists
// them and redraws them on resume. Both paths share one renderer per card,
// so a card looks the same on either host.

import path from "node:path";
import { Text, type Component } from "@earendil-works/pi-tui";
import { POLL_TOOL_NAME, type NativeDisplayEvent } from "../provider.js";
import type { PollRunData } from "../poll-fold.js";
import { isOmpHost } from "./host.js";

export const NATIVE_EVENT_CARD = "agy-native-event";
export const POLL_RUN_CARD = "agy-poll-run";

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
