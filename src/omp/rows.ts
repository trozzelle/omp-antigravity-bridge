// Host-independent static text for tool and card renders. Both hosts draw a
// `{ render(width) }` rows object. Rows wrap to the width the way pi's Text
// component did: pi throws on a row wider than the terminal, and OMP cuts it
// without an ellipsis. The ANSI-aware wrap comes from the host's own TUI kit,
// loaded once by loadTextWrap() when the factory starts (setupOmpHost).

import { isOmpHost } from "./host.js";
import { importLegacyPiTui } from "./legacy-ui.js";

export interface RowsComponent {
	render(width: number): string[];
	invalidate(): void;
}

type Wrap = (text: string, width: number) => string[];

let wrapText: Wrap | undefined;

/** Load the host's wrap once per process. Under pi a failure propagates (its
 *  pi-tui is always present). Under OMP the module is served by OMP itself and
 *  is absent only outside it (Node tests on an OMP-shaped host); rows then stay
 *  unwrapped and OMP cuts them. */
export async function loadTextWrap(): Promise<void> {
	if (wrapText) return;
	if (!isOmpHost()) {
		wrapText = (await importLegacyPiTui()).wrapTextWithAnsi as Wrap;
		return;
	}
	try {
		// Literal specifier: OMP rewrites only literal imports onto its own package.
		wrapText = (await import("@oh-my-pi/pi-tui/text/width")).wrap;
	} catch {
		// Not running under OMP.
	}
}

/** Immutable multi-line text, wrapped per render width (cached per width). */
export function textRows(text: string): RowsComponent {
	const normalized = text.trim() ? text.replace(/\t/g, "   ") : "";
	let cachedWidth = -1;
	let cachedRows: string[] = [];
	return {
		render(width) {
			if (!normalized) return [];
			if (width !== cachedWidth) {
				cachedWidth = width;
				cachedRows = wrapText ? wrapText(normalized, Math.max(1, width)) : normalized.split("\n");
			}
			return cachedRows;
		},
		invalidate() {
			cachedWidth = -1;
		},
	};
}
