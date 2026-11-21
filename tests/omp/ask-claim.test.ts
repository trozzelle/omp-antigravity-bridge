import { expect, test, vi } from "vitest";

// pi-ask-antigravity registers its own AskAntigravity unless this flag is set
// when its factory runs. Hosts import every extension module before running
// any factory, so the claim must happen at import time.
const BRIDGE_FLAG = Symbol.for("pi-antigravity-bridge:active");

test("importing the extension claims AskAntigravity before any factory runs", async () => {
	Reflect.deleteProperty(globalThis, BRIDGE_FLAG);
	vi.resetModules();
	await import("../../extensions/index.js");
	expect(Reflect.get(globalThis, BRIDGE_FLAG)).toBe(true);
});
