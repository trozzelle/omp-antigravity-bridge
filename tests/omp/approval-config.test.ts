// approvals.mode "inherit": the OMP default, pi unchanged (spec P8).
//
// Run: npx vitest run tests/omp/approval-config.test.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "vitest";
import { loadConfig, saveConfig } from "../../src/config.js";
import { __setHostForTests } from "../../src/omp/host.js";

let dir = "";
let cfg = "";

beforeEach(() => {
	delete process.env.AGY_APPROVALS;
	delete process.env.AGY_APPROVALS_MODE;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-approval-cfg-"));
	cfg = path.join(dir, "config.json");
});

afterEach(() => {
	__setHostForTests(undefined);
	delete process.env.AGY_APPROVALS;
	delete process.env.AGY_APPROVALS_MODE;
	fs.rmSync(dir, { recursive: true, force: true });
});

test("under OMP approvals.mode defaults to inherit; explicit file and env values win", () => {
	__setHostForTests("omp");
	assert.deepEqual(loadConfig(cfg).approvals, { gateMode: "auto", mode: "inherit" });
	fs.writeFileSync(cfg, JSON.stringify({ approvals: { mode: "ask" } }));
	assert.equal(loadConfig(cfg).approvals.mode, "ask");
	fs.writeFileSync(cfg, JSON.stringify({ approvals: { mode: "bogus" } }));
	assert.equal(loadConfig(cfg).approvals.mode, "inherit");
	fs.writeFileSync(cfg, JSON.stringify({ approvals: { mode: "ask" } }));
	process.env.AGY_APPROVALS_MODE = "INHERIT";
	assert.equal(loadConfig(cfg).approvals.mode, "inherit");
});

test("under pi inherit has no host mode to defer to and reads as ask", () => {
	__setHostForTests("pi");
	assert.equal(loadConfig(cfg).approvals.mode, "ask");
	process.env.AGY_APPROVALS_MODE = "inherit";
	assert.equal(loadConfig(cfg).approvals.mode, "ask");
});

test("saving under OMP never bakes ask over the inherit default", () => {
	__setHostForTests("omp");
	fs.writeFileSync(cfg, JSON.stringify({}));
	saveConfig({ mode: "accept-edits" }, cfg);
	const raw: unknown = JSON.parse(fs.readFileSync(cfg, "utf8"));
	assert.ok(typeof raw === "object" && raw !== null && "approvals" in raw);
	assert.deepEqual(raw.approvals, { gateMode: "auto", mode: "inherit" });
	assert.equal(loadConfig(cfg).approvals.mode, "inherit");

	fs.writeFileSync(cfg, JSON.stringify({ approvals: { gateMode: "shadow" } }));
	saveConfig({ mode: "accept-edits" }, cfg);
	const raw2: unknown = JSON.parse(fs.readFileSync(cfg, "utf8"));
	assert.ok(typeof raw2 === "object" && raw2 !== null && "approvals" in raw2);
	assert.deepEqual(raw2.approvals, { gateMode: "shadow", mode: "inherit" });
});
