import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Component } from "@earendil-works/pi-tui";
import type { NativeDisplayEvent } from "../../src/provider.js";
import type { PollRunData } from "../../src/poll-fold.js";
import {
	NATIVE_EVENT_CARD,
	POLL_RUN_CARD,
	emitDisplayCard,
	nativeEventSummary,
	pollRunSummary,
	registerCardRenderers,
	renderNativeEventCard,
	type CardEntryRenderer,
	type CardHost,
	type CardMessage,
	type CardMessageRenderer,
	type CardTheme,
} from "../../src/omp/cards.js";
import { __setHostForTests } from "../../src/omp/host.js";

// Colour names become visible tags so assertions can check styling.
const theme: CardTheme = { fg: (color, text) => `<${color}>${text}</${color}>` };

function draw(component: Component | undefined): string[] {
	if (!component) throw new Error("renderer returned no component");
	return component.render(200).map((line) => line.trimEnd());
}

function fakeHost(opts: { entryRenderers: boolean }) {
	const entryRenderers = new Map<string, CardEntryRenderer>();
	const messageRenderers = new Map<string, CardMessageRenderer>();
	const sent: CardMessage[] = [];
	const appended: Array<{ customType: string; data: unknown }> = [];
	const host: CardHost = {
		registerMessageRenderer: (customType, renderer) => {
			messageRenderers.set(customType, renderer);
		},
		sendMessage: (message) => {
			sent.push(message);
		},
		appendEntry: (customType, data) => {
			appended.push({ customType, data });
		},
	};
	if (opts.entryRenderers) {
		host.registerEntryRenderer = (customType, renderer) => {
			entryRenderers.set(customType, renderer);
		};
	}
	return { host, entryRenderers, messageRenderers, sent, appended };
}

const writeEvent: NativeDisplayEvent = {
	name: "write_file",
	status: "completed",
	path: "/work/b.txt",
	diff: "-beta\n+beta\n+epsilon",
};

const pollRun: PollRunData = {
	target: "git_commit",
	count: 3,
	state: "failed",
	firstAt: "2026-11-21T10:00:00.000Z",
	lastAt: "2026-11-21T10:00:30.000Z",
};

afterEach(() => __setHostForTests(undefined));

describe("cards under pi", () => {
	beforeEach(() => __setHostForTests("pi"));

	test("a native event card persists as a custom entry and never reaches the transcript as a message", () => {
		const { host, sent, appended } = fakeHost({ entryRenderers: true });
		emitDisplayCard(host, NATIVE_EVENT_CARD, writeEvent, nativeEventSummary(writeEvent));
		expect(appended).toEqual([{ customType: NATIVE_EVENT_CARD, data: writeEvent }]);
		expect(sent).toEqual([]);
	});

	test("expanded native event shows the basename, full path and coloured diff", () => {
		const { host, entryRenderers } = fakeHost({ entryRenderers: true });
		registerCardRenderers(host);
		const render = entryRenderers.get(NATIVE_EVENT_CARD);
		if (!render) throw new Error("native event renderer not registered");
		expect(draw(render({ data: writeEvent }, { expanded: true }, theme))).toEqual([
			"<success>✓</success> <toolTitle>write_file</toolTitle> <muted>b.txt</muted>",
			"<dim>/work/b.txt</dim>",
			"<toolDiffRemoved>-beta</toolDiffRemoved>",
			"<toolDiffAdded>+beta</toolDiffAdded>",
			"<toolDiffAdded>+epsilon</toolDiffAdded>",
		]);
	});
});

describe("cards under OMP", () => {
	beforeEach(() => __setHostForTests("omp"));

	test("a native event card is a display-only message excluded from model context", () => {
		const { host, sent, appended } = fakeHost({ entryRenderers: false });
		emitDisplayCard(host, NATIVE_EVENT_CARD, writeEvent, nativeEventSummary(writeEvent));
		expect(sent).toEqual([
			{
				customType: NATIVE_EVENT_CARD,
				content: "[agy-native-event] ✓ write_file /work/b.txt",
				display: true,
				details: writeEvent,
				excludeFromContext: true,
			},
		]);
		expect(appended).toEqual([]);
	});

	test("message renderers draw exactly what the pi entry renderers draw", () => {
		const omp = fakeHost({ entryRenderers: false });
		registerCardRenderers(omp.host);
		__setHostForTests("pi");
		const pi = fakeHost({ entryRenderers: true });
		registerCardRenderers(pi.host);
		const cases: Array<[string, unknown]> = [
			[NATIVE_EVENT_CARD, writeEvent],
			[POLL_RUN_CARD, pollRun],
		];
		for (const [customType, data] of cases) {
			const fromMessage = omp.messageRenderers.get(customType);
			const fromEntry = pi.entryRenderers.get(customType);
			if (!fromMessage || !fromEntry) throw new Error(`${customType} renderer missing`);
			for (const expanded of [false, true]) {
				expect(draw(fromMessage({ details: data }, { expanded }, theme))).toEqual(draw(fromEntry({ data }, { expanded }, theme)));
			}
		}
		expect(omp.entryRenderers.size).toBe(0);
	});

	test("collapsed poll-run card counts the polls and flags failure", () => {
		const { host, messageRenderers } = fakeHost({ entryRenderers: false });
		registerCardRenderers(host);
		const render = messageRenderers.get(POLL_RUN_CARD);
		if (!render) throw new Error("poll-run renderer not registered");
		expect(draw(render({ details: pollRun }, { expanded: false }, theme))).toEqual([
			"♊︎ <toolTitle>bridge_poll_result</toolTitle> <muted>Poll git_commit (x3, failed)</muted>",
		]);
	});
});

describe("native event card terminal safety", () => {
	test("expanded command output drops the carriage return of CRLF line endings", () => {
		const lines = draw(renderNativeEventCard({ name: "run_command", status: "completed", command: "echo CARD_TEST", output: "CARD_TEST\r\n" }, true, theme));
		assert.ok(lines.includes("<toolOutput>CARD_TEST</toolOutput>"), JSON.stringify(lines));
		assert.ok(lines.every((line) => !line.includes("\r")), JSON.stringify(lines));
	});

	test("bare carriage returns become line breaks and other control bytes are stripped from output, diff and command", () => {
		const lines = draw(
			renderNativeEventCard(
				{
					name: "run_command",
					status: "failed",
					command: "echo a\r\nb\x1b[2J",
					output: "10%\r50%\r100%\x07\x00 done",
					diff: "-old\r\n+new\x08",
				},
				true,
				theme,
			),
		);
		assert.deepEqual(lines, [
			"<error>✗</error> <toolTitle>run_command</toolTitle> <muted>echo a</muted>",
			"<toolDiffRemoved>-old</toolDiffRemoved>",
			"<toolDiffAdded>+new</toolDiffAdded>",
			"<toolOutput>10%</toolOutput>",
			"<toolOutput>50%</toolOutput>",
			"<toolOutput>100% done</toolOutput>",
		]);
	});
});

describe("card summaries", () => {
	test("native event summary names the tool and its most specific target on one line", () => {
		expect(nativeEventSummary({ name: "run_command", status: "failed", command: "ls -la\necho done" })).toBe(
			"[agy-native-event] ✗ run_command ls -la",
		);
		expect(nativeEventSummary({ name: "list_dir", status: "completed" })).toBe("[agy-native-event] ✓ list_dir");
	});

	test("poll-run summary carries target, count and failure", () => {
		expect(pollRunSummary(pollRun)).toBe("[agy-poll-run] bridge_poll_result → git_commit (x3, failed)");
		expect(pollRunSummary({ ...pollRun, state: "done", count: 1 })).toBe("[agy-poll-run] bridge_poll_result → git_commit (x1)");
	});
});
