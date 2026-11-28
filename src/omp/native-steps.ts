// The acp.nativeSteps setting's surfaces under OMP: /agy steps, the
// settings-picker row and the /agy settings row. pi has no such setting
// (it always draws cards), so every export is empty or a notice there.
// The display rule itself is nativeStepMode() in cards.ts.

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { DialogRow } from "./dialog-types.js";
import { configPath, loadConfig, saveConfig, type AgyConfig } from "../config.js";
import { toNativeSteps } from "./config.js";
import { nativeStepMode } from "./cards.js";
import { isOmpHost } from "./host.js";

export const NATIVE_STEPS_ROW_ID = "native-steps";

const DESCRIPTION = {
	inline: "agy's native tool steps (ACP) show as trace lines in the reply's thinking, in the order they ran.",
	cards: "agy's native tool steps (ACP) show as separate cards, which OMP draws below the reply once it finishes.",
} as const;

/** `/agy steps [inline|cards]`: set the mode, or report it with usage. */
export function runStepsCommand(val: string | undefined, ui: Pick<ExtensionUIContext, "notify"> | undefined, configFile: string = configPath()): void {
	if (!isOmpHost()) {
		ui?.notify("/agy steps is OMP only: pi draws native steps as cards.", "info");
		return;
	}
	const wanted = toNativeSteps(val);
	if (!wanted) {
		ui?.notify(`steps: ${nativeStepMode(loadConfig(configFile))}\nusage: /agy steps inline|cards (ACP engine)`, "info");
		return;
	}
	saveConfig({ acp: { nativeSteps: wanted } }, configFile);
	ui?.notify(`steps ${wanted}. ${DESCRIPTION[wanted]} Applies from the next step.`, "info");
	const effective = nativeStepMode(loadConfig(configFile));
	if (effective !== wanted) {
		ui?.notify(`AGY_NATIVE_STEPS is set in this environment and overrides the config: steps stay ${effective} until you unset it.`, "warning");
	}
}

/** The /agy settings row; none under pi. */
export function nativeStepsSettingsRows(config: AgyConfig, row: (label: string, value: string) => string): string[] {
	return isOmpHost() ? [row("native steps:", nativeStepMode(config))] : [];
}

/** The settings-picker row; none under pi. Its pick narrows with toNativeSteps. */
export function nativeStepsPickerRows(config: AgyConfig): DialogRow[] {
	if (!isOmpHost()) return [];
	return [
		{
			id: NATIVE_STEPS_ROW_ID,
			label: "Native steps (ACP)",
			description: "How agy's own tool steps show. inline: trace lines in the reply's thinking, in the order they ran. cards: separate cards, which OMP draws below the reply once it finishes.",
			currentValue: nativeStepMode(config),
			values: ["inline", "cards"],
		},
	];
}
