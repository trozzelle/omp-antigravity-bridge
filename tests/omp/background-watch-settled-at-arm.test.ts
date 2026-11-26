// inkling2 2026-11-25: 19 of 20 background-task wakes reported tasks the model
// had already awaited in-turn, each costing a full model turn to answer
// "already completed". A fresh arm drops tasks that are holder-free and idle at
// the first poll; a task still running at settle keeps its wake, and reload
// re-arms (option off) keep reporting tasks that finished while pi was down.
import assert from "node:assert/strict";
import { test } from "vitest";
import { armBackgroundWatch, type BackgroundWatchOptions } from "../../src/background-watch.js";
import type { AgyTask } from "../../src/tasks.js";

function makeClock() {
	let t = 0;
	return {
		now: () => t,
		sleep(ms: number) {
			t += ms;
			return Promise.resolve();
		},
	};
}

function task(overrides: Partial<AgyTask> = {}): AgyTask {
	return {
		id: 2,
		logPath: `/brain/conv/.system_generated/tasks/task-${overrides.id ?? 2}.log`,
		bytes: 100,
		modifiedMs: 0,
		active: false,
		livenessKnown: true,
		...overrides,
	};
}

const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

async function drive(
	scanner: (clock: ReturnType<typeof makeClock>) => Promise<AgyTask[]>,
	extra: Partial<BackgroundWatchOptions>,
): Promise<{ wakes: string[]; logs: string[] }> {
	const clock = makeClock();
	const wakes: string[] = [];
	const logs: string[] = [];
	const watch = armBackgroundWatch({
		conversationId: "conv-1",
		conversationDir: "/brain/conv",
		turnStartMs: -60_000,
		listTasks: () => scanner(clock),
		tail: async (logPath) => `tail of ${logPath}`,
		sendWake: (c) => wakes.push(c),
		log: (event) => logs.push(event),
		sleep: clock.sleep,
		now: clock.now,
		...extra,
	});
	for (let i = 0; i < 20 && !watch.stopped; i++) {
		await clock.sleep(5_000);
	}
	await tick();
	assert.equal(watch.stopped, true);
	return { wakes, logs };
}

test("fresh arm drops tasks that settled before the turn ended (silent stop)", async () => {
	const { wakes, logs } = await drive(async () => [task({ id: 2, modifiedMs: -10_000 }), task({ id: 3, modifiedMs: -40_000 })], {
		ignoreSettledAtArm: true,
	});
	assert.equal(wakes.length, 0);
	assert.ok(logs.includes("background-watch-already-settled"));
});

test("fresh arm still wakes for a task running at settle, without the settled ones", async () => {
	let polls = 0;
	const { wakes } = await drive(
		async () => {
			polls += 1;
			return [task({ id: 2, modifiedMs: -10_000 }), task({ id: 59, active: polls <= 2, modifiedMs: 0 })];
		},
		{ ignoreSettledAtArm: true },
	);
	assert.equal(wakes.length, 1);
	assert.match(wakes[0]!, /task-59/);
	assert.doesNotMatch(wakes[0]!, /task-2\b/);
});

test("fresh arm keeps a holder-free task written within the arm grace window", async () => {
	let writtenAt: number | undefined;
	const { wakes } = await drive(
		async (clock) => {
			writtenAt ??= clock.now() - 500;
			return [task({ id: 2, modifiedMs: writtenAt })];
		},
		{ ignoreSettledAtArm: true },
	);
	assert.equal(wakes.length, 1);
	assert.match(wakes[0]!, /task-2/);
});

test("the filter is inert when lsof liveness is unknown, and off for reload re-arms", async () => {
	for (const opts of [
		{ ignoreSettledAtArm: true, livenessKnown: false },
		{ ignoreSettledAtArm: false, livenessKnown: true },
	]) {
		const { wakes } = await drive(async () => [task({ id: 2, modifiedMs: -10_000, livenessKnown: opts.livenessKnown })], {
			ignoreSettledAtArm: opts.ignoreSettledAtArm,
		});
		assert.equal(wakes.length, 1, JSON.stringify(opts));
	}
});
