// Everything extensions/index.ts uses from src/omp, behind one import line,
// so upstream changes to that file's import block merge cleanly (each
// separate fork import used to be a conflict point on a sync).
//
// For extensions/index.ts only. Modules under src/ keep importing the
// specific src/omp file they need: several src/omp modules import back from
// src/, and routing src/ through this barrel would turn those into cycles.

export { acpPermissionPolicy, effectiveGateMode, readOmpApprovalSettings } from "./approval-settings.js";
export { wireOmpApprovalGate } from "./approval-gate.js";
export {
	NATIVE_EVENT_CARD,
	POLL_RUN_CARD,
	emitDisplayCard,
	nativeEventSummary,
	nativeStepMode,
	nativeStepTrace,
	pollRunSummary,
	registerCardContextFilter,
	registerCardRenderers,
} from "./cards.js";
export { toNativeSteps, type NativeSteps } from "./config.js";
export type { DialogRow } from "./dialog-types.js";
export {
	createOmpOneshots,
	isOmpWorkerRealm,
	ompRefusesPatchCleanup,
	ompSessionKind,
	setupOmpHost,
	watchOmpModelChanges,
} from "./extension.js";
export { isOmpHost } from "./host.js";
export { importLegacyDialogs } from "./legacy-ui.js";
export { applySettingsChange, type PendingConfig } from "./settings.js";
export { NATIVE_STEPS_ROW_ID, nativeStepsPickerRows, nativeStepsSettingsRows, runStepsCommand } from "./native-steps.js";
export { showReport } from "./report.js";
export { ompSettingsMenu } from "./pickers.js";
export { sessionKindOf, type SessionKind } from "./runtime.js";
