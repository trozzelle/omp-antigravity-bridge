// Host detection: the one place the extension decides whether it runs inside
// OMP (oh-my-pi) or pi. Every OMP-specific branch asks isOmpHost().

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

export type HostKind = "omp" | "pi";

let host: HostKind | undefined;

/** "omp" when the ExtensionAPI carries OMP's `pi.pi.settings` object;
 *  otherwise "omp" only when the host's config dir is `.omp`. */
export function detectHost(pi: unknown): HostKind {
	if (typeof pi === "object" && pi !== null && "pi" in pi) {
		const inner: unknown = pi.pi;
		if (typeof inner === "object" && inner !== null && "settings" in inner) {
			const settings: unknown = inner.settings;
			if (typeof settings === "object" && settings !== null) return "omp";
		}
	}
	return CONFIG_DIR_NAME === ".omp" ? "omp" : "pi";
}

/** Detect once per process. Called first in the extension factory; later
 *  factory runs (OMP re-runs it per subagent) keep the first answer. */
export function initHost(pi: unknown): HostKind {
	host ??= detectHost(pi);
	return host;
}

/** True under OMP. Before initHost runs, falls back to the config-dir check
 *  without memoizing it. */
export function isOmpHost(): boolean {
	return (host ?? detectHost(undefined)) === "omp";
}

/** Test seam: force the detected host, or clear it with undefined. */
export function __setHostForTests(kind: HostKind | undefined): void {
	host = kind;
}
