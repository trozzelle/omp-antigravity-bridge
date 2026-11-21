import { describe, expect, test } from "vitest";
import { ModelChangeTracker } from "../../src/omp/model-change.js";

const flash = { provider: "antigravity", id: "gemini-3-8-flash", api: "agy-bridge" };
const hydrogen = { provider: "antigravity", id: "gemini-4-hydrogen", api: "agy-bridge" };
const opus = { provider: "anthropic", id: "claude-opus-5-5", api: "anthropic-messages" };

describe("ModelChangeTracker", () => {
	test("the model a session starts or resumes on is not a switch", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline(flash);
		expect(tracker.observe(flash)).toBeUndefined();
	});

	test("a switch is reported once, at the first prompt on the new model", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline(opus);
		expect(tracker.observe(hydrogen)).toEqual(hydrogen);
		expect(tracker.observe(hydrogen)).toBeUndefined();
	});

	test("switching back is a new switch", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline(flash);
		tracker.observe(opus);
		expect(tracker.observe(flash)).toEqual(flash);
	});

	test("models are told apart by provider and id together", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline({ provider: "google", id: "gemini-3-8-flash" });
		expect(tracker.observe(flash)).toEqual(flash);
	});

	test("picking a model after starting without one is a switch", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline(undefined);
		expect(tracker.observe(flash)).toEqual(flash);
	});

	test("a new baseline (resume, reload) replaces the last model seen", () => {
		const tracker = new ModelChangeTracker();
		tracker.baseline(opus);
		tracker.baseline(flash);
		expect(tracker.observe(flash)).toBeUndefined();
	});
});
