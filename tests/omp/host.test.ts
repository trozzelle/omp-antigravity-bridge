import { afterEach, describe, expect, it } from "vitest";
import { __setHostForTests, detectHost, initHost, isOmpHost } from "../../src/omp/host.js";

const ompPi = { pi: { settings: { get: () => undefined } }, on: () => {} };
const piPi = { on: () => {}, registerEntryRenderer: () => {} };

afterEach(() => __setHostForTests(undefined));

describe("host detection", () => {
	it("recognises OMP by the ExtensionAPI's pi.settings object", () => {
		expect(detectHost(ompPi)).toBe("omp");
	});

	it("treats a pi ExtensionAPI as pi (config dir .pi)", () => {
		expect(detectHost(piPi)).toBe("pi");
		expect(detectHost({ pi: {} })).toBe("pi");
		expect(detectHost({ pi: { settings: null } })).toBe("pi");
		expect(detectHost(undefined)).toBe("pi");
	});

	it("keeps the first factory's answer for later factory runs", () => {
		expect(initHost(ompPi)).toBe("omp");
		expect(initHost(piPi)).toBe("omp");
		expect(isOmpHost()).toBe(true);
	});

	it("reports pi before initHost runs on a pi host", () => {
		expect(isOmpHost()).toBe(false);
	});
});
