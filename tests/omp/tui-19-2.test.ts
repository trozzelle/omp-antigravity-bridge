import { afterEach, describe, expect, it, vi } from "vitest";
import { showArtifactsBrowser } from "../../src/artifacts-ui.js";
import type { AgyArtifact } from "../../src/artifacts.js";
import { showTasksBrowser } from "../../src/tasks-ui.js";
import type { AgyTask } from "../../src/tasks.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { loadTextWrap, textRows } from "../../src/omp/rows.js";

interface SelectOption {
	label: string;
	description?: string;
}

const plain = (row: string): string => row.replace(/\x1b\[[0-9;]*m/g, "");

const artifact: AgyArtifact = {
	name: "plan.md",
	absolutePath: "/tmp/plan.md",
	kind: "conversation",
	mediaType: "markdown",
	bytes: 42,
	modifiedMs: Date.UTC(2026, 10, 27, 12, 0),
};

const task: AgyTask = {
	id: 7,
	logPath: "/tmp/task-7.log",
	bytes: 42,
	modifiedMs: Date.UTC(2026, 10, 27, 12, 0),
	active: true,
	livenessKnown: true,
};

afterEach(() => __setHostForTests(undefined));

function captureCustom<T>(): { ui: unknown; view: () => unknown } {
	let captured: unknown;
	const ui = {
		custom: (
			factory: (host: unknown, theme: unknown, keys: unknown, done: (value: T) => void) => unknown,
			_options?: unknown,
		) =>
			new Promise<T>((resolve) => {
				const done = (value: T) => resolve(value);
				captured = factory(
					{ requestRender() {} },
					{ fg: (_c: string, t: string) => t, bold: (t: string) => t },
					undefined,
					done,
				);
			}),
	};
	return { ui, view: () => captured };
}

describe("OMP 19.2 native browsers", () => {
	it("opens the artifact selected by its label", async () => {
		__setHostForTests("omp");
		const ui = {
			select: async (_title: string, options: SelectOption[]) => options[0]?.label,
		};
		await expect(showArtifactsBrowser(ui as never, [artifact])).resolves.toEqual({ type: "open", artifact });
	});

	it("maps the artifact browser's rescan action", async () => {
		__setHostForTests("omp");
		const ui = {
			select: async (_title: string, options: SelectOption[]) => options.at(-1)?.label,
		};
		await expect(showArtifactsBrowser(ui as never, [artifact])).resolves.toEqual({ type: "rescan" });
	});

	it("maps the task browser's rescan action", async () => {
		__setHostForTests("omp");
		const ui = {
			select: async (_title: string, options: SelectOption[]) => options.at(-1)?.label,
		};
		await expect(showTasksBrowser(ui as never, [task], true)).resolves.toEqual({ type: "rescan" });
	});

	it("keeps task descriptions and moves the lsof warning and tail hint into the subtitle", async () => {
		__setHostForTests("omp");
		let title = "";
		let options: SelectOption[] = [];
		const ui = {
			select: async (t: string, o: SelectOption[]) => {
				title = t;
				options = o;
				return undefined;
			},
		};
		await expect(showTasksBrowser(ui as never, [{ ...task, livenessKnown: false }], false)).resolves.toEqual({ type: "close" });
		expect(title.split("\n")).toEqual([
			"Antigravity tasks (1)",
			"lsof not found; liveness unknown (install lsof for ACTIVE/idle)",
			"/agy tasks tail <id> for a log",
		]);
		expect(options[0]?.description).toMatch(/^42B · last write \d\d:\d\d$/);
	});
});

describe("textRows", () => {
	it("wraps styled text to the render width", async () => {
		__setHostForTests("pi");
		await loadTextWrap();
		const rows = textRows(`\x1b[31m${"word ".repeat(20).trim()}\x1b[0m\nshort`);
		const narrow = rows.render(12);
		expect(narrow.length).toBeGreaterThan(3);
		for (const row of narrow) expect(plain(row).length).toBeLessThanOrEqual(12);
		expect(plain(narrow.join(" ")).replace(/\s+/g, " ").trim()).toBe(`${"word ".repeat(20)}short`);
		expect(rows.render(200).map(plain)).toEqual(["word ".repeat(20).trim(), "short"]);
	});
});

describe("pi overlays", () => {
	it("drives the artifact overlay's rescan action", async () => {
		__setHostForTests("pi");
		const { ui, view } = captureCustom<unknown>();
		const pending = showArtifactsBrowser(ui as never, [artifact]);
		await vi.waitFor(() => {
			if (!view()) throw new Error("overlay not captured");
		});
		(view() as { handleInput(data: string): void }).handleInput("r");
		await expect(pending).resolves.toEqual({ type: "rescan" });
	});

	it("drives the task overlay's rescan action", async () => {
		__setHostForTests("pi");
		const { ui, view } = captureCustom<unknown>();
		const pending = showTasksBrowser(ui as never, [task], true);
		await vi.waitFor(() => {
			if (!view()) throw new Error("overlay not captured");
		});
		(view() as { handleInput(data: string): void }).handleInput("r");
		await expect(pending).resolves.toEqual({ type: "rescan" });
	});
});
