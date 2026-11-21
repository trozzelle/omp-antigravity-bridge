// Type surface of OMP's settings registry subpath, used by
// src/omp/approval-settings.ts through a literal dynamic import. The package
// is never installed here (pi devDeps, Node tests); OMP serves it at runtime
// by rewriting the literal specifier in extension sources.
declare module "@oh-my-pi/pi-coding-agent/config/registry" {
	export function lookup(id: string): { get(scope: unknown): unknown } | undefined;
}
