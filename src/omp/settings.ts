// Settings-picker state shared by the pi dialog kit and OMP's native picker.
import type { AcpConfig, AgyMode, BridgeTools, ThinkingTier } from "../config.js";
import { toNativeSteps } from "./config.js";
import { NATIVE_STEPS_ROW_ID } from "./native-steps.js";

export interface PendingConfig {
	mode?: AgyMode;
	readOnly?: boolean;
	skipPermissions?: boolean;
	defaultModel?: string;
	defaultThinking?: ThinkingTier;
	turnTimeoutMin?: number;
	askTool?: boolean;
	webTools?: boolean;
	bridgeTools?: BridgeTools;
	digest?: boolean;
	systemPrompt?: boolean;
	acp?: Partial<AcpConfig>;
}

/** Apply one cycled picker row to `pending`. Both hosts' menus call this. */
export function applySettingsChange(pending: PendingConfig, id: string, newValue: string): void {
	if (id === "mode") {
		pending.mode = newValue as AgyMode;
	} else if (id === "readonly") {
		pending.readOnly = newValue === "on";
	} else if (id === "permissions") {
		pending.skipPermissions = newValue === "auto-approved";
	} else if (id === "model") {
		pending.defaultModel = newValue;
	} else if (id === "thinking") {
		pending.defaultThinking = newValue as ThinkingTier;
	} else if (id === "ask") {
		pending.askTool = newValue === "on";
	} else if (id === "web") {
		pending.webTools = newValue === "on";
	} else if (id === "bridge") {
		pending.bridgeTools = newValue as BridgeTools;
	} else if (id === "turn-cap") {
		pending.turnTimeoutMin = Number(newValue);
	} else if (id === "digest") {
		pending.digest = newValue === "on";
	} else if (id === "system-prompt") {
		pending.systemPrompt = newValue === "on";
	} else if (id === "acp-session-timeout") {
		pending.acp = { ...pending.acp, sessionTimeoutMs: Number(newValue) };
	} else if (id === "acp-session-retry") {
		pending.acp = { ...pending.acp, sessionRetryOnTimeout: newValue === "on" };
	} else if (id === NATIVE_STEPS_ROW_ID) {
		pending.acp = { ...pending.acp, nativeSteps: toNativeSteps(newValue) };
	}
}
