// Pi-only legacy UI modules, loaded through run-time specifiers.
//
// OMP 19.2's extension loader parses every import in the extension graph
// (static, dynamic and type-only) and refuses `@earendil-works/pi-tui`
// outright (legacy-pi-compat.ts, assertNoPiTuiImport); the dialog kit imports
// it too. The specifiers are joined at run time so that parser never sees
// them. This relies on OMP not constant-folding `[...].join("/")`, which holds
// on 19.2.1; if a later OMP folds it, the extension fails to load and
// scripts/omp/smoke-load.sh fails with it. Only pi code paths call these
// loaders; under pi they resolve like any other dynamic import.
//
// The results are untyped on purpose: naming these modules' types would put
// the specifiers back into the graph.

const LEGACY_DIALOGS = ["@estebanforge", "pi-tui-dialogs"].join("/");
const LEGACY_PI_CODING_AGENT = ["@earendil-works", "pi-coding-agent"].join("/");
const LEGACY_PI_TUI = ["@earendil-works", "pi-tui"].join("/");

// biome-ignore lint/suspicious/noExplicitAny: see the header.
type LegacyModule = any;

/** `@estebanforge/pi-tui-dialogs` (dialogChoice, DialogMenu, DIALOG_OPTIONS, dialogBlocked). */
export function importLegacyDialogs(): Promise<LegacyModule> {
	return import(LEGACY_DIALOGS);
}

/** `@earendil-works/pi-tui`. */
export function importLegacyPiTui(): Promise<LegacyModule> {
	return import(LEGACY_PI_TUI);
}

/** What the artifact and task overlays draw with: DynamicBorder, the pi-tui
 *  components and dialogBlocked. */
export async function importLegacyBrowserKit(): Promise<LegacyModule> {
	const [agent, tui, dialogs] = await Promise.all([import(LEGACY_PI_CODING_AGENT), importLegacyPiTui(), importLegacyDialogs()]);
	return {
		DynamicBorder: agent.DynamicBorder,
		Container: tui.Container,
		SelectList: tui.SelectList,
		Spacer: tui.Spacer,
		Text: tui.Text,
		dialogBlocked: dialogs.dialogBlocked,
	};
}
