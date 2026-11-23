// acp.nativeSteps (OMP): the inline trace format, the mode rule, its config
// and /agy steps, and the context filter that keeps cards away from the model.
//
// Run: npx vitest run tests/omp/native-steps.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "vitest";
import { loadConfig, saveConfig } from "../../src/config.js";
import { NATIVE_EVENT_CARD, POLL_RUN_CARD, nativeStepMode, nativeStepTrace, registerCardContextFilter, type CardContextHost } from "../../src/omp/cards.js";
import { runStepsCommand } from "../../src/omp/native-steps.js";
import { __setHostForTests } from "../../src/omp/host.js";

afterEach(() => __setHostForTests(undefined));

describe("nativeStepTrace", () => {
	test("is its own markdown paragraph so consecutive steps never merge into one line", () => {
		const two = nativeStepTrace({ name: "read_file", status: "completed" }) + nativeStepTrace({ name: "list_dir", status: "completed" });
		assert.match(two, /✓ read_file\n\n+✓ list_dir/);
	});

	test("an edit shows the basename and a fenced diff that survives backtick runs in the diff", () => {
		const trace = nativeStepTrace({ name: "edit_file", status: "completed", path: "/w/src/a.md", diff: "-```js\n+```ts" });
		assert.equal(trace, "\n✓ edit_file `a.md`\n````diff\n-```js\n+```ts\n````\n\n");
	});

	test("a command holding backticks keeps them inside one code span", () => {
		assert.equal(nativeStepTrace({ name: "run_command", status: "completed", command: "echo `date`" }), "\n✓ run_command `` echo `date` ``\n\n");
	});

	test("a failure shows the error's first line only", () => {
		assert.equal(nativeStepTrace({ name: "read_file", status: "failed", output: "ENOENT: no such file\nstack…" }), "\n✗ read_file: ENOENT: no such file\n\n");
	});

	test("terminal control bytes never reach the thinking stream", () => {
		const trace = nativeStepTrace({ name: "run_command", status: "failed", command: "echo a\x1b[2J", output: "boom\x07" });
		assert.ok(!/[\x00-\x08\x0b-\x1f\x7f]/.test(trace.replace(/\n/g, "")), JSON.stringify(trace));
	});
});

describe("card context filter", () => {
	function capture(): { host: CardContextHost; handler: () => ((event: { messages: unknown[] }) => unknown) | undefined } {
		let registered: ((event: { messages: unknown[] }) => unknown) | undefined;
		const host = {
			on: (event: string, handler: (event: { messages: unknown[] }) => unknown) => {
				if (event === "context") registered = handler;
			},
		} as unknown as CardContextHost;
		return { host, handler: () => registered };
	}

	test("under OMP saved cards never reach the model; other custom messages do", () => {
		__setHostForTests("omp");
		const { host, handler } = capture();
		registerCardContextFilter(host);
		const keep = { role: "custom", customType: "agy-background-task", content: "done" };
		const user = { role: "user", content: "hi" };
		const messages = [
			user,
			{ role: "custom", customType: NATIVE_EVENT_CARD, content: "[agy-native-event] ✓ read_file" },
			keep,
			{ role: "custom", customType: POLL_RUN_CARD, content: "[agy-poll-run] …" },
		];
		assert.deepEqual(handler()?.({ messages }), { messages: [user, keep] });
		assert.equal(handler()?.({ messages: [user] }), undefined);
	});

	test("under pi nothing is registered (cards are entries there, not messages)", () => {
		__setHostForTests("pi");
		const { host, handler } = capture();
		registerCardContextFilter(host);
		assert.equal(handler(), undefined);
	});
});

describe("acp.nativeSteps config", () => {
	let dir = "";
	let cfg = "";
	beforeEach(() => {
		delete process.env.AGY_NATIVE_STEPS;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-native-steps-"));
		cfg = path.join(dir, "config.json");
	});
	afterEach(() => {
		delete process.env.AGY_NATIVE_STEPS;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("defaults to inline under OMP, junk falls back to inline, and pi has no key (its cards and config shape stay upstream's)", () => {
		__setHostForTests("omp");
		assert.equal(loadConfig(cfg).acp.nativeSteps, "inline");
		fs.writeFileSync(cfg, JSON.stringify({ acp: { nativeSteps: "bogus" } }));
		assert.equal(loadConfig(cfg).acp.nativeSteps, "inline");
		__setHostForTests("pi");
		assert.equal("nativeSteps" in loadConfig(cfg).acp, false);
	});

	test("the file chooses cards under OMP and the env wins over the file", () => {
		__setHostForTests("omp");
		fs.writeFileSync(cfg, JSON.stringify({ acp: { nativeSteps: "cards" } }));
		assert.equal(loadConfig(cfg).acp.nativeSteps, "cards");
		process.env.AGY_NATIVE_STEPS = "INLINE";
		assert.equal(loadConfig(cfg).acp.nativeSteps, "inline");
	});

	test("saving normalizes a hand-edited value, drops junk, and never writes the default for a user who did not choose", () => {
		__setHostForTests("omp");
		// JSON.parse is untyped; a missing key reads as undefined.
		const savedSteps = (): unknown => JSON.parse(fs.readFileSync(cfg, "utf8")).acp?.nativeSteps;
		fs.writeFileSync(cfg, JSON.stringify({ acp: { nativeSteps: "CARDS" } }));
		assert.equal(saveConfig({ digest: false }, cfg).acp.nativeSteps, "cards");
		assert.equal(savedSteps(), "cards");
		fs.writeFileSync(cfg, JSON.stringify({ acp: { nativeSteps: "bogus" } }));
		saveConfig({ digest: false }, cfg);
		assert.equal(savedSteps(), undefined);
		fs.writeFileSync(cfg, JSON.stringify({}));
		saveConfig({ digest: false }, cfg);
		assert.equal(savedSteps(), undefined);
		assert.equal(loadConfig(cfg).acp.nativeSteps, "inline");
	});

	test("pi always draws cards, whatever the config holds", () => {
		__setHostForTests("pi");
		assert.equal(nativeStepMode({ acp: { usageEstimate: "estimate", sessionTimeoutMs: 20000, sessionRetryOnTimeout: false, nativeSteps: "inline" } }), "cards");
		__setHostForTests("omp");
		assert.equal(nativeStepMode(loadConfig(cfg)), "inline");
	});
});

describe("/agy steps", () => {
	let dir = "";
	let cfg = "";
	const notes: Array<[string, string | undefined]> = [];
	const ui = { notify: (message: string, type?: "info" | "warning" | "error") => void notes.push([message, type]) };
	beforeEach(() => {
		delete process.env.AGY_NATIVE_STEPS;
		notes.length = 0;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-steps-cmd-"));
		cfg = path.join(dir, "config.json");
		__setHostForTests("omp");
	});
	afterEach(() => {
		delete process.env.AGY_NATIVE_STEPS;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("sets the mode case-insensitively and reports it without an argument", () => {
		runStepsCommand("CARDS", ui, cfg);
		assert.equal(loadConfig(cfg).acp.nativeSteps, "cards");
		assert.match(notes[0][0], /^steps cards\. /);
		runStepsCommand(undefined, ui, cfg);
		assert.match(notes[1][0], /^steps: cards\nusage: /);
	});

	test("warns when AGY_NATIVE_STEPS overrides the saved choice", () => {
		process.env.AGY_NATIVE_STEPS = "inline";
		runStepsCommand("cards", ui, cfg);
		assert.deepEqual(notes[1], ["AGY_NATIVE_STEPS is set in this environment and overrides the config: steps stay inline until you unset it.", "warning"]);
	});

	test("is a notice under pi and writes nothing", () => {
		__setHostForTests("pi");
		runStepsCommand("cards", ui, cfg);
		assert.equal(fs.existsSync(cfg), false);
		assert.match(notes[0][0], /OMP only/);
	});
});
