import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { skillsFromCommands, type SkillCommandsHost } from "../../src/omp/skills.js";
import { sessionSkills } from "../../src/skills.js";
import { __setHostForTests } from "../../src/omp/host.js";

const host = (commands: unknown[]): SkillCommandsHost => ({ getCommands: () => commands });

// OMP SlashCommandInfo: { name, description?, source, location?, path? }.
const ompCommands = [
	{ name: "agy", description: "Antigravity provider", source: "extension" },
	{ name: "review", description: "Review prompt", source: "prompt", path: "/home/u/.omp/agent/commands/review.md" },
	{ name: "skill:brainstorming", description: "Explore intent\n  before building", source: "skill", path: "/home/u/.omp/plugins/sp/skills/brainstorming/SKILL.md" },
	{ name: "skill:zoom-out", description: "Step back", source: "skill", path: "/home/u/.omp/agent/skills/zoom-out/SKILL.md" },
];

// OMP's system prompt arrives as string[]; the model-visible list is the <skills> block.
const ompPrompt = [
	"You are omp.",
	"# Skills & Rules\nMatching skill → MUST read skill://<name> first.\n<skills>\n- brainstorming: Explore intent before building\n</skills>",
];

// A prompt rendered from OMP's default template when no skill is visible: no block.
const defaultPromptNoSkills = "You are omp's trusted coding assistant.\n# Skills & Rules\n<generic-rules>\nbe nice\n</generic-rules>";

afterEach(() => __setHostForTests(undefined));

describe("skillsFromCommands under OMP", () => {
	test("keeps only skill commands, strips the prefix and points at the SKILL.md", () => {
		__setHostForTests("omp");
		expect(skillsFromCommands(host(ompCommands))).toEqual([
			{
				name: "brainstorming",
				description: "Explore intent before building",
				filePath: "/home/u/.omp/plugins/sp/skills/brainstorming/SKILL.md",
				dir: "/home/u/.omp/plugins/sp/skills/brainstorming",
			},
			{
				name: "zoom-out",
				description: "Step back",
				filePath: "/home/u/.omp/agent/skills/zoom-out/SKILL.md",
				dir: "/home/u/.omp/agent/skills/zoom-out",
			},
		]);
	});

	test("drops skills OMP hides from the model (absent from the <skills> listing)", () => {
		__setHostForTests("omp");
		const names = skillsFromCommands(host(ompCommands), { systemPrompt: () => ompPrompt }).map((s) => s.name);
		expect(names).toEqual(["brainstorming"]);
	});

	test("a default-template prompt with no <skills> block means no visible skills", () => {
		__setHostForTests("omp");
		const names = skillsFromCommands(host(ompCommands), { systemPrompt: () => [defaultPromptNoSkills] }).map((s) => s.name);
		expect(names).toEqual([]);
	});

	test("a custom prompt with no <skills> block keeps every skill", () => {
		__setHostForTests("omp");
		const names = skillsFromCommands(host(ompCommands), { systemPrompt: () => ["custom prompt"] }).map((s) => s.name);
		expect(names).toEqual(["brainstorming", "zoom-out"]);
	});

	test("honours an explicit hide flag on the command", () => {
		__setHostForTests("omp");
		const names = skillsFromCommands(host([{ ...ompCommands[3], hide: true }, ompCommands[2]])).map((s) => s.name);
		expect(names).toEqual(["brainstorming"]);
	});

	test("skips skills with no description or a non-file path; the first of a duplicate name wins", () => {
		__setHostForTests("omp");
		const skills = skillsFromCommands(
			host([
				{ name: "skill:empty", description: "  ", source: "skill", path: "/s/empty/SKILL.md" },
				{ name: "skill:virtual", description: "x", source: "skill", path: "builtin:virtual" },
				{ name: "skill:twice", description: "first", source: "skill", path: "/a/twice/SKILL.md" },
				{ name: "skill:twice", description: "second", source: "skill", path: "/b/twice/SKILL.md" },
			]),
		);
		expect(skills.map((s) => s.filePath)).toEqual(["/a/twice/SKILL.md"]);
	});

	test("a host whose getCommands throws lists nothing", () => {
		__setHostForTests("omp");
		expect(
			skillsFromCommands({
				getCommands: () => {
					throw new Error("stale extension context");
				},
			}),
		).toEqual([]);
	});
});

describe("skillsFromCommands under pi", () => {
	test("reads the SKILL.md path from sourceInfo and ignores the system prompt", () => {
		__setHostForTests("pi");
		const piCommands = [
			{ name: "skill:deploy", description: "Ship it", source: "skill", sourceInfo: { path: "/home/u/.pi/agent/skills/deploy/SKILL.md", source: "local", scope: "user", origin: "top-level" } },
		];
		const skills = skillsFromCommands(host(piCommands), { systemPrompt: () => "<skills>\n</skills>" });
		expect(skills).toEqual([
			{ name: "deploy", description: "Ship it", filePath: "/home/u/.pi/agent/skills/deploy/SKILL.md", dir: "/home/u/.pi/agent/skills/deploy" },
		]);
	});
});

describe("sessionSkills", () => {
	function scanRoot(): { home: string; agentDir: string } {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "agy-omp-skills-"));
		const dir = path.join(home, ".agents", "skills", "scanned");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: scanned\ndescription: found on disk\n---\n");
		return { home, agentDir: path.join(home, ".pi", "agent") };
	}

	test("prefers the host's skill list over the directory scan", () => {
		__setHostForTests("omp");
		expect(sessionSkills(host(ompCommands), scanRoot()).map((s) => s.name)).toEqual(["brainstorming", "zoom-out"]);
	});

	test("falls back to the directory scan when the host lists no skills", () => {
		__setHostForTests("omp");
		expect(sessionSkills(host(ompCommands.slice(0, 2)), scanRoot()).map((s) => s.name)).toEqual(["scanned"]);
	});

	test("the directory-scan fallback applies the same visibility filter", () => {
		__setHostForTests("omp");
		const noCommands = host([]);
		// Default prompt, no block: nothing is visible, so the scan finds nothing usable.
		expect(sessionSkills(noCommands, scanRoot(), { systemPrompt: () => [defaultPromptNoSkills] })).toEqual([]);
		// Block that does not list the scanned skill (hidden): dropped.
		expect(sessionSkills(noCommands, scanRoot(), { systemPrompt: () => ompPrompt }).map((s) => s.name)).toEqual([]);
		// Block that lists it: kept.
		const listing = ["You are omp.", "<skills>\n- scanned: found on disk\n</skills>"];
		expect(sessionSkills(noCommands, scanRoot(), { systemPrompt: () => listing }).map((s) => s.name)).toEqual(["scanned"]);
		// Custom prompt without a block: kept.
		expect(sessionSkills(noCommands, scanRoot(), { systemPrompt: () => "custom" }).map((s) => s.name)).toEqual(["scanned"]);
	});
});
