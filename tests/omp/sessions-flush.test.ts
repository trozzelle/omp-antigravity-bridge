import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SessionStore } from "../../src/sessions.js";
import { tmpStorePath } from "./fixtures/omp-context.js";

const record = (conversationId: string) => ({ conversationId, lastStepIdx: -1, lastMessageCount: 3 });

describe("SessionStore.flush", () => {
	it("resolves only after queued sets and deletes are on disk", async () => {
		const file = tmpStorePath();
		const store = new SessionStore(file);
		store.set("sid:a@acp", record("conv-a"));
		store.set("sid:b@acp", record("conv-b"));
		store.delete("sid:b@acp");
		await store.flush();
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ "sid:a@acp": record("conv-a") });
		expect(new SessionStore(file).get("sid:a@acp")?.conversationId).toBe("conv-a");
	});

	it("also waits for a write queued while the flush is pending", async () => {
		const file = tmpStorePath();
		const store = new SessionStore(file);
		const flushed = store.flush();
		store.set("sid:late@acp", record("conv-late"));
		await flushed;
		expect(new SessionStore(file).get("sid:late@acp")?.conversationId).toBe("conv-late");
	});
});
