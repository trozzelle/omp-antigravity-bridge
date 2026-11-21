// OMP's pi-coding-agent shim does not export generateDiffString. These tests
// load diff-render against a pi-coding-agent module without it (as on OMP)
// and hold the fallback to pi's real output byte for byte.
import { describe, expect, it, vi } from "vitest";
import type * as PiCodingAgent from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
	const actual = await importOriginal<typeof PiCodingAgent>();
	return Object.fromEntries(Object.entries(actual).filter(([name]) => name !== "generateDiffString"));
});

const { generateDiffString: piGenerateDiffString } = await vi.importActual<typeof PiCodingAgent>(
	"@earendil-works/pi-coding-agent",
);
const { fallbackGenerateDiffString } = await import("../../src/omp/diff-fallback.js");
const { TurnDiffContext, formatInlineDiff } = await import("../../src/diff-render.js");

const numbered = (from: number, to: number): string =>
	Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`).join("\n");

const cases: Array<[string, string, string]> = [
	["single-line change", "a\nb\nc\n", "a\nB\nc\n"],
	["new file", "", "first\nsecond\n"],
	["file emptied", "first\nsecond\n", ""],
	["no trailing newline", "x\ny", "x\ny\nz"],
	["edits far apart with elided middle", `${numbered(1, 40)}\n`, `${numbered(1, 40).replace("line 3\n", "line three\n").replace("line 37\n", "line 37b\n")}\n`],
	["edits close together share context", `${numbered(1, 12)}\n`, `${numbered(1, 12).replace("line 2\n", "two\n").replace("line 9\n", "nine\n")}\n`],
	["width grows past 9 lines", `${numbered(1, 9)}\n`, `${numbered(1, 9)}\nline 10\nline 11\n`],
	["repeated lines", "}\n}\n}\nend\n", "}\n}\nmid\n}\nend\n"],
];

describe("diff rendering without the host's generateDiffString", () => {
	it.each(cases)("fallback matches pi's generateDiffString: %s", (_name, before, after) => {
		expect(fallbackGenerateDiffString(before, after)).toEqual(piGenerateDiffString(before, after));
	});

	it("formatInlineDiff renders pi's format when the host lacks generateDiffString", () => {
		const [, before, after] = cases[4];
		expect(formatInlineDiff(before, after)).toBe(piGenerateDiffString(before, after).diff);
	});

	it("TurnDiffContext diffs a tracked file against HEAD in pi's format", () => {
		const ctx = new TurnDiffContext({ toplevel: () => "/repo", showHead: () => "a\nb\nc\n" });
		const outcome = ctx.diffEdit("/repo/f.txt", "a\nB\nc\n");
		expect(outcome).toEqual({ kind: "diff", text: piGenerateDiffString("a\nb\nc\n", "a\nB\nc\n").diff });
	});
});
