/**
 * Pin OMP's context-occupancy read to the corrected total.
 *
 * OMP reads `usage.contextTokens ?? input + cacheRead + cacheWrite` as live
 * occupancy, both for auto-compaction (~85% of the window by default) and for
 * its overflow check. On agy, input and cacheRead are billing sums over every
 * inference of the turn, so they overstate the context several times over.
 * Upstream's `clampOverflowUsage` only rescales once those sums pass the FULL
 * window, which left 85-100% open: inkling2 2026-11-25 compacted three times
 * at a recorded 918k-963k "before" while the corrected total was 205k-480k.
 *
 * `contextTokens` is an OMP Usage field outside the pi-ai type, so it is set
 * structurally; upstream pi ignores it.
 */
export function stampContextTokens(usage: { totalTokens: number; contextTokens?: number }): void {
	if (!Number.isFinite(usage.totalTokens) || usage.totalTokens <= 0) return;
	usage.contextTokens = usage.totalTokens;
}
