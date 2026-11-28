// Type surface of OMP's text-width subpath, used by src/omp/rows.ts through a
// literal dynamic import. The package is never installed here (pi devDeps,
// Node tests); OMP serves it at runtime by rewriting the literal specifier in
// extension sources.
declare module "@oh-my-pi/pi-tui/text/width" {
	export function wrap(text: string, width: number): string[];
}
