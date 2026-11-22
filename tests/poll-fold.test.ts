// Unit tests for the bridge_poll_result display fold: consecutive poll
// events collapse into ONE counted transcript entry instead of flooding it
// (observed live 2026-10-21: 60 "Poll git_commit" entries from one wait).

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { PollRunFolder, foldPollEvent, type PollEventInput } from "../src/poll-fold.js";

const at = (iso: string) => new Date(iso);

describe("poll-fold", () => {
	test("folds consecutive polls of one target into a single counted run", () => {
		const f = new PollRunFolder();
		assert.ok(f.open === undefined);
		assert.equal(f.add("git_commit", "running", at("2026-10-21T16:07:20Z")), undefined);
		assert.equal(f.add("git_commit", "running", at("2026-10-21T16:07:50Z")), undefined);
		assert.equal(f.add("git_commit", "running", at("2026-10-21T16:08:30Z")), undefined);
		assert.deepEqual(f.flush(), {
			target: "git_commit",
			count: 3,
			state: "running",
			firstAt: "2026-10-21T16:07:20.000Z",
			lastAt: "2026-10-21T16:08:30.000Z",
		});
	});

	test("a target switch closes the open run and folds the new target", () => {
		const f = new PollRunFolder();
		f.add("git_commit", "running", at("2026-10-21T16:07:20Z"));
		f.add("git_commit", "done", at("2026-10-21T16:08:00Z"));
		const closed = f.add("ask_user_question", "done", at("2026-10-21T16:09:00Z"));
		assert.deepEqual(closed, {
			target: "git_commit",
			count: 2,
			state: "done",
			firstAt: "2026-10-21T16:07:20.000Z",
			lastAt: "2026-10-21T16:08:00.000Z",
		});
		assert.deepEqual(f.flush(), {
			target: "ask_user_question",
			count: 1,
			state: "done",
			firstAt: "2026-10-21T16:09:00.000Z",
			lastAt: "2026-10-21T16:09:00.000Z",
		});
	});

	test("terminal states stick: running after done does not downgrade, failed wins", () => {
		const f = new PollRunFolder();
		f.add("read", "done", at("2026-10-21T16:00:00Z"));
		f.add("read", "running", at("2026-10-21T16:00:10Z"));
		assert.equal(f.open?.state, "done");
		f.add("read", "failed", at("2026-10-21T16:00:20Z"));
		assert.equal(f.open?.state, "failed");
		f.add("read", "running", at("2026-10-21T16:00:30Z"));
		assert.equal(f.open?.state, "failed");
	});

	test("flush is idempotent and open exposes the live run for the status line", () => {
		const f = new PollRunFolder();
		assert.equal(f.flush(), undefined);
		f.add("git_commit", "running", at("2026-10-21T16:07:20Z"));
		// Fresh getter read: TS property narrowing from an earlier assert on
		// f.open survives the f.add() call, so assert the property only after
		// this point.
		const open = f.open;
		assert.ok(open);
		assert.equal(open.count, 1);
		assert.equal(open.target, "git_commit");
		assert.ok(f.flush());
		assert.equal(f.flush(), undefined);
		assert.ok(f.open === undefined);
	});

	test("unresolvable-target polls fold together under their fallback label", () => {
		const f = new PollRunFolder();
		f.add("unknown call", "failed", at("2026-10-21T16:00:00Z"));
		f.add("unknown call", "failed", at("2026-10-21T16:00:05Z"));
		const run = f.flush();
		assert.equal(run?.count, 2);
		assert.equal(run?.state, "failed");
	});

	// The driver reports every ACP tool step twice (started, then completed
	// or failed): a poll must count once, on the settling event.
	describe("foldPollEvent", () => {
		const view = { name: "slow_probe", state: "running" as const };
		const poll = (f: PollRunFolder, ev: PollEventInput, v?: { name: string; state: "running" | "done" | "failed" }) =>
			foldPollEvent(f, ev, v, at("2026-11-21T10:00:00Z"));

		test("a started+completed pair counts one poll", () => {
			const f = new PollRunFolder();
			poll(f, { status: "started", callId: "c1" }, view);
			poll(f, { status: "completed", callId: "c1" }, view);
			assert.equal(f.open?.count, 1);
		});

		test("three polls count three, not six", () => {
			const f = new PollRunFolder();
			for (const callId of ["c1", "c2", "c3"]) {
				poll(f, { status: "started", callId }, view);
				poll(f, { status: "completed", callId }, view);
			}
			assert.equal(f.flush()?.count, 3);
		});

		test("started drives the live counter without folding, previewing the poll in flight", () => {
			const f = new PollRunFolder();
			assert.deepEqual(poll(f, { status: "started", callId: "c1" }, view).live, { target: "slow_probe", count: 1 });
			assert.equal(f.flush(), undefined);
			poll(f, { status: "completed", callId: "c1" }, view);
			assert.deepEqual(poll(f, { status: "started", callId: "c2" }, view).live, { target: "slow_probe", count: 2 });
			assert.equal(f.open?.count, 1);
			assert.deepEqual(poll(f, { status: "completed", callId: "c2" }, view).live, { target: "slow_probe", count: 2 });
		});

		test("a target switch is reported on the settling event and a started poll of the new target previews 1", () => {
			const f = new PollRunFolder();
			poll(f, { status: "completed", callId: "c1" }, view);
			const next = { name: "git_commit", state: "running" as const };
			assert.deepEqual(poll(f, { status: "started", callId: "c2" }, next).live, { target: "git_commit", count: 1 });
			const settled = poll(f, { status: "completed", callId: "c2" }, next);
			assert.equal(settled.switched?.target, "slow_probe");
			assert.equal(settled.switched?.count, 1);
			assert.deepEqual(settled.live, { target: "git_commit", count: 1 });
		});

		test("a failed poll with a callId folds under that call's target as failed", () => {
			const f = new PollRunFolder();
			poll(f, { status: "failed", callId: "c1" }, view);
			assert.equal(f.open?.target, "slow_probe");
			assert.equal(f.open?.state, "failed");
			assert.equal(f.open?.count, 1);
		});

		test("a failed poll with no callId stays in the open run instead of splitting off an unknown call", () => {
			const f = new PollRunFolder();
			poll(f, { status: "started", callId: "c1" }, view);
			poll(f, { status: "completed", callId: "c1" }, view);
			poll(f, { status: "started", callId: "c2" }, view);
			const settled = poll(f, { status: "failed" });
			assert.equal(settled.switched, undefined);
			assert.equal(f.open?.target, "slow_probe");
			assert.equal(f.open?.count, 2);
			assert.equal(f.open?.state, "failed");
		});

		test("with no callId and no open run the target falls back to the unknown label", () => {
			const f = new PollRunFolder();
			poll(f, { status: "failed" });
			assert.equal(f.open?.target, "unknown call");
		});

		test("a callId the registry cannot resolve is an unknown call, even beside an open run", () => {
			const f = new PollRunFolder();
			poll(f, { status: "completed", callId: "c1" }, view);
			const settled = poll(f, { status: "completed", callId: "gone" });
			assert.equal(settled.switched?.target, "slow_probe");
			assert.equal(f.open?.target, "unknown call");
		});

		test("the settled state follows the registry view; failed events force failed", () => {
			const f = new PollRunFolder();
			poll(f, { status: "completed", callId: "c1" }, { name: "slow_probe", state: "done" });
			assert.equal(f.open?.state, "done");
			poll(f, { status: "failed", callId: "c2" }, { name: "slow_probe", state: "running" });
			assert.equal(f.open?.state, "failed");
		});
	});
});
