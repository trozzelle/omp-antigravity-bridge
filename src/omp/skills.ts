// activate_skill catalog from the host's own skill list.
//
// pi.getCommands() lists every skill the session loaded as a `skill:<name>`
// command. That covers sources the directory scan never sees (plugin
// skills, custom dirs, settings toggles) on both hosts. The SKILL.md path
// is `path` on OMP and `sourceInfo.path` on pi 1.6.
//
// OMP hides some skills from the model (frontmatter `hide`,
// `disableModelInvocation`, `manualSkills`) but its command list carries no
// hide flag. The model-visible list is the `<skills>` block of OMP's system
// prompt, so under OMP a skill missing from that block is dropped. OMP leaves
// the block out when no visible skill remains (all hidden, or no active tool
// reads `skill://`): in a prompt built from the default template that means
// no visible skills; a custom prompt carries no such signal, so it keeps all.

import path from "node:path";
import type { SkillLite } from "../skills.js";
import { OMP_DEFAULT_PROMPT_IDENTITY } from "./context.js";
import { isOmpHost } from "./host.js";

const SKILL_COMMAND_PREFIX = "skill:";

/** The ExtensionAPI member the catalog reads. */
export interface SkillCommandsHost {
	getCommands(): readonly unknown[];
}

export interface SkillsFromCommandsOptions {
	/** The session's system prompt (OMP: string[]); read only under OMP. */
	systemPrompt?: () => string | readonly string[];
}

function commandFilePath(command: object): string | undefined {
	if ("path" in command && typeof command.path === "string" && command.path) return command.path;
	if (
		"sourceInfo" in command &&
		typeof command.sourceInfo === "object" &&
		command.sourceInfo !== null &&
		"path" in command.sourceInfo &&
		typeof command.sourceInfo.path === "string"
	) {
		return command.sourceInfo.path;
	}
	return undefined;
}

function skillFromCommand(command: unknown): SkillLite | undefined {
	if (typeof command !== "object" || command === null) return undefined;
	if (!("source" in command) || command.source !== "skill") return undefined;
	if ("hide" in command && command.hide === true) return undefined;
	if (!("name" in command) || typeof command.name !== "string" || !command.name.startsWith(SKILL_COMMAND_PREFIX)) return undefined;
	const name = command.name.slice(SKILL_COMMAND_PREFIX.length);
	const description = "description" in command && typeof command.description === "string" ? command.description.trim() : "";
	const filePath = commandFilePath(command);
	// Same rule as the directory scan: no description, no skill. A path that
	// is not a file on disk (synthetic source) cannot be read by activate_skill.
	if (!name || !description || !filePath || !path.isAbsolute(filePath)) return undefined;
	return { name, description: description.replace(/\s+/g, " ").slice(0, 160), filePath, dir: path.dirname(filePath) };
}

/** Lines of the first `<skills>…</skills>` block, or undefined when the prompt has none. */
function listedSkillLines(text: string): string[] | undefined {
	const open = text.indexOf("<skills>");
	if (open < 0) return undefined;
	const close = text.indexOf("</skills>", open);
	if (close < 0) return undefined;
	return text.slice(open + "<skills>".length, close).split("\n");
}

/** Whether a skill is visible to the model under OMP, judged from the system
 *  prompt; undefined when nothing can be inferred (pi, or no prompt given). */
export function skillVisibility(options: SkillsFromCommandsOptions = {}): ((skill: SkillLite) => boolean) | undefined {
	if (!isOmpHost() || !options.systemPrompt) return undefined;
	const raw = options.systemPrompt();
	const text = typeof raw === "string" ? raw : raw.join("\n");
	const listed = listedSkillLines(text);
	// No block in a default-template prompt: OMP showed the model no skills.
	// No block in a custom prompt: it is not OMP's template, nothing to infer.
	if (!listed) return text.trimStart().startsWith(OMP_DEFAULT_PROMPT_IDENTITY) ? () => false : undefined;
	// `- name: description` is OMP's listing format (system-prompt.md).
	return (skill) => listed.some((line) => line.startsWith(`- ${skill.name}: `));
}

/** Skills the session loaded, as listed by `pi.getCommands()`; [] when the host lists none. */
export function skillsFromCommands(pi: SkillCommandsHost, options: SkillsFromCommandsOptions = {}): SkillLite[] {
	let commands: unknown;
	try {
		commands = pi.getCommands();
	} catch {
		return [];
	}
	// A host (or test double) without a command list yields no skills.
	if (!Array.isArray(commands)) return [];
	const visible = skillVisibility(options);
	const seen = new Set<string>();
	const out: SkillLite[] = [];
	for (const command of commands) {
		const skill = skillFromCommand(command);
		if (!skill || seen.has(skill.name)) continue;
		if (visible && !visible(skill)) continue;
		seen.add(skill.name);
		out.push(skill);
	}
	return out;
}
