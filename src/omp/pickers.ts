// OMP replacements for the pi dialog kit (@estebanforge/pi-tui-dialogs), which
// OMP 19.2 cannot load (legacy-ui.ts). Each picker drives OMP's native
// selector, which takes labelled options with descriptions and resolves the
// picked label. Upstream call sites reach these through one line each; the
// browser hooks resolve undefined under pi, where the caller draws its overlay.

import type { AgyArtifact } from "../artifacts.js";
import type { ArtifactsBrowserAction } from "../artifacts-ui.js";
import type { TasksBrowserAction } from "../tasks-ui.js";
import type { ChoiceOption, DialogContext, DialogRow, SelectItem } from "./dialog-types.js";
import { isOmpHost } from "./host.js";
import { importLegacyDialogs } from "./legacy-ui.js";

interface SelectOption {
	label: string;
	description?: string;
}

interface SelectDialogOptions {
	helpText?: string;
	initialIndex?: number;
}

/** OMP's ExtensionUIContext.select. Upstream pi's type declares string[]
 *  options only, so every call goes through this one cast. */
function selectOmp(ui: object, title: string, options: SelectOption[], dialogOptions: SelectDialogOptions): Promise<string | undefined> {
	const omp = ui as { select(title: string, options: SelectOption[], dialogOptions: SelectDialogOptions): Promise<string | undefined> };
	return omp.select(title, options, dialogOptions);
}

/** The dialog kit's dialogChoice signature. */
export type DialogChoice = (
	ctx: DialogContext,
	title: string,
	options: { options: ChoiceOption[]; description?: string; footer?: string | readonly string[] },
) => Promise<string | undefined>;

/** dialogChoice for the running host: OMP's selector (the description becomes
 *  the subtitle), else the pi dialog kit's. Resolves the picked value. */
export async function hostDialogChoice(): Promise<DialogChoice> {
	if (!isOmpHost()) return (await importLegacyDialogs()).dialogChoice as DialogChoice;
	return async (ctx, title, { options, description, footer }) => {
		const picked = await selectOmp(
			ctx.ui,
			description ? `${title}\n${description}` : title,
			options.map((option) => ({ label: option.label, description: option.description })),
			{ helpText: typeof footer === "string" ? footer : footer?.join(" · ") },
		);
		return options.find((option) => option.label === picked)?.value;
	};
}

/** /agy artifacts on OMP: one row per artifact plus Rescan. */
export async function ompArtifactsBrowser(
	ui: object,
	artifacts: AgyArtifact[],
	items: SelectItem[],
): Promise<ArtifactsBrowserAction | undefined> {
	if (!isOmpHost()) return undefined;
	const rescan = { label: "Rescan", description: "Scan this conversation's artifacts again" };
	// Numbered labels: artifact names can repeat, and none can read "Rescan".
	const options = items.map((item, index) => ({ label: `${index + 1}. ${item.label}`, description: item.description }));
	const picked = await selectOmp(ui, `Antigravity artifacts (${artifacts.length})`, [...options, rescan], {
		helpText: "enter open · esc close",
	});
	if (picked === rescan.label) return { type: "rescan" };
	const index = options.findIndex((option) => option.label === picked);
	return index >= 0 ? { type: "open", artifact: artifacts[index]! } : { type: "close" };
}

/** /agy tasks on OMP: one row per task plus Rescan; the pi overlay's warning
 *  and footer hint ride the subtitle. */
export async function ompTasksBrowser(
	ui: object,
	items: SelectItem[],
	livenessKnown: boolean,
): Promise<TasksBrowserAction | undefined> {
	if (!isOmpHost()) return undefined;
	const rescan = { label: "Rescan", description: "Scan this conversation's background tasks again" };
	const title = [
		`Antigravity tasks (${items.length})`,
		...(livenessKnown ? [] : ["lsof not found; liveness unknown (install lsof for ACTIVE/idle)"]),
		"/agy tasks tail <id> for a log",
	].join("\n");
	const options = items.map((item) => ({ label: item.label, description: item.description }));
	const picked = await selectOmp(ui, title, [...options, rescan], { helpText: "enter close · esc close" });
	return picked === rescan.label ? { type: "rescan" } : { type: "close" };
}

export interface OmpSettingsMenuOptions {
	title: string;
	subtitle: string;
	rows: DialogRow[];
	onChange(id: string, newValue: string): void;
}

/** The kit's DialogMenu on OMP's selector. Enter on a row with values cycles
 *  it in place (onChange) and reopens on that row; a value-less row resolves
 *  its id; esc resolves undefined. */
export async function ompSettingsMenu(ui: object, menu: OmpSettingsMenuOptions): Promise<string | undefined> {
	let cursor = 0;
	for (;;) {
		const picked = await selectOmp(
			ui,
			`${menu.title}\n${menu.subtitle}`,
			menu.rows.map((row) => ({
				label: row.label,
				description: [`current: ${row.currentValue}`, row.description].filter(Boolean).join(" — "),
			})),
			{ helpText: "enter cycle/open · esc close", initialIndex: cursor },
		);
		cursor = menu.rows.findIndex((row) => row.label === picked);
		const row = menu.rows[cursor];
		if (!row) return undefined;
		if (!row.values?.length) return row.id;
		const next = row.values[(row.values.indexOf(row.currentValue) + 1) % row.values.length]!;
		row.currentValue = next;
		menu.onChange(row.id, next);
	}
}
