// Line-numbered display diff for hosts whose pi-coding-agent shim does not
// export generateDiffString (OMP 19.1). A port of pi-coding-agent 1.6's
// generateDiffString (dist/core/tools/edit-diff.js) over the same jsdiff
// diffLines, so the thinking-stream diff reads identically on both hosts.

import { diffLines } from "diff";

export interface DisplayDiff {
	diff: string;
	firstChangedLine: number | undefined;
}

/** Same output as pi's `generateDiffString(oldContent, newContent, contextLines)`:
 *  `+<n> line` / `-<n> line` / ` <n> line` rows, line numbers right-aligned to
 *  the widest count, and ` <pad> ...` for elided context. */
export function fallbackGenerateDiffString(oldContent: string, newContent: string, contextLines = 4): DisplayDiff {
	const width = String(Math.max(oldContent.split("\n").length, newContent.split("\n").length)).length;
	const parts = diffLines(oldContent, newContent);
	const output: string[] = [];
	const num = (n: number): string => String(n).padStart(width, " ");
	const gap = ` ${"".padStart(width, " ")} ...`;
	let oldLine = 1;
	let newLine = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") raw.pop();
		if (part.added || part.removed) {
			firstChangedLine ??= newLine;
			for (const line of raw) {
				if (part.added) {
					output.push(`+${num(newLine)} ${line}`);
					newLine++;
				} else {
					output.push(`-${num(oldLine)} ${line}`);
					oldLine++;
				}
			}
			lastWasChange = true;
			continue;
		}
		const next = parts[i + 1];
		const trailingChange = next !== undefined && (next.added === true || next.removed === true);
		const context = (lines: string[]): void => {
			for (const line of lines) {
				output.push(` ${num(oldLine)} ${line}`);
				oldLine++;
				newLine++;
			}
		};
		const skip = (count: number): void => {
			output.push(gap);
			oldLine += count;
			newLine += count;
		};
		if (lastWasChange && trailingChange) {
			if (raw.length <= contextLines * 2) {
				context(raw);
			} else {
				context(raw.slice(0, contextLines));
				skip(raw.length - contextLines * 2);
				context(raw.slice(raw.length - contextLines));
			}
		} else if (lastWasChange) {
			context(raw.slice(0, contextLines));
			if (raw.length > contextLines) skip(raw.length - contextLines);
		} else if (trailingChange) {
			const skipped = Math.max(0, raw.length - contextLines);
			if (skipped > 0) skip(skipped);
			context(raw.slice(skipped));
		} else {
			oldLine += raw.length;
			newLine += raw.length;
		}
		lastWasChange = false;
	}
	return { diff: output.join("\n"), firstChangedLine };
}
