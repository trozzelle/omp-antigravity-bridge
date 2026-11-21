// OMP one-shot calls on the stream-json engine.
//
// Compaction, title and branch-summary calls and `/btw` side turns run in a
// throwaway agy conversation (isEphemeralCall, src/omp/oneshot.ts). A
// stream-json agy process serves one conversation, so on the session's own
// driver every such call restarted the session's warm agy (and the next turn
// restarted it again to resume), and it waited behind the session's open
// turn, parked tool calls included. Here each one-shot turn gets its own agy
// process in an isolated home with no bridge entry, closed once the turn
// settles: nothing executes a one-shot turn's tool calls, so there is no
// continuation to keep it for.

import { removeStagedAgyHome, stageAgyHome } from "../acp/home.js";
import { StreamDriver } from "../driver.js";
import type { DriverSnapshot, DriverState, DriverTurnRequest, TurnDriver, TurnHandle, TurnOutcome } from "../driver-types.js";
import type { AgyModelEntry } from "../models.js";
import { createStreamSimple, ToolRoundTrips } from "../provider.js";
import type { SessionStore } from "../sessions.js";
import type { BridgeStreamSimple } from "./runtime.js";

/** Runs every turn on a fresh driver from `make` and closes it once the turn settles. */
export class OneshotDriver implements TurnDriver {
	readonly #make: () => TurnDriver;
	readonly #live = new Set<TurnDriver>();
	#turns = 0;

	constructor(make: () => TurnDriver) {
		this.#make = make;
	}

	get state(): DriverState {
		return this.#live.size > 0 ? "running" : "idle";
	}

	/** No continuation, bridge call or approval ever targets a one-shot turn. */
	get activeHandle(): TurnHandle | null {
		return null;
	}

	reentry(): TurnHandle | null {
		return null;
	}

	kickIdle(): void {}

	set onTurnEnd(_fn: ((outcome: TurnOutcome) => void) | undefined) {}

	async run(request: DriverTurnRequest): Promise<TurnHandle> {
		const driver = this.#make();
		this.#live.add(driver);
		this.#turns += 1;
		const dispose = async (): Promise<void> => {
			this.#live.delete(driver);
			await driver.close("shutdown");
		};
		try {
			const handle = await driver.run(request);
			void handle.outcome.catch(() => undefined).then(dispose);
			return handle;
		} catch (err) {
			await dispose();
			throw err;
		}
	}

	snapshot(): DriverSnapshot {
		return {
			state: this.state,
			stats: { spawns: this.#turns, turns: this.#turns, reused: 0, recycles: 0, recycleReasons: {} },
			lifecycle: [],
		};
	}

	async close(): Promise<void> {
		const live = [...this.#live];
		this.#live.clear();
		await Promise.all(live.map((driver) => driver.close("shutdown")));
	}
}

export interface OneshotProviderDeps {
	entries: AgyModelEntry[];
	store: SessionStore;
	log: (event: string, data?: unknown, level?: "debug" | "info" | "warn" | "error") => void;
	/** Lifecycle sink for the throwaway drivers (the session driver's). */
	driverLog?: StreamDriver["log"];
}

/** The session's provider for one-shot calls. Without a replay store agy's
 *  steps stay labels instead of tool cards, which would end the reply at the
 *  first step; no `activate_skill` either, since the home has no bridge. */
export function createOneshotProvider(deps: OneshotProviderDeps): { streamSimple: BridgeStreamSimple; close(): Promise<void> } {
	const driver = new OneshotDriver(() => {
		const turn = new StreamDriver();
		turn.log = deps.driverLog;
		// A staging failure fails the call: a one-shot never falls back to the
		// global config, where other sessions' bridge entries live.
		turn.stagedHome = () => stageAgyHome({ prefix: "agy-home" });
		turn.releaseStagedHome = (home) => removeStagedAgyHome(home);
		return turn;
	});
	const streamSimple = createStreamSimple({
		entries: deps.entries,
		store: deps.store,
		driver,
		roundTrips: new ToolRoundTrips(driver),
		engine: "stream-json",
		log: deps.log,
	});
	return { streamSimple, close: () => driver.close() };
}
