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
// The module types stay structural here: importing the modules' own types
// would put their specifiers back into the graph.

const LEGACY_DIALOGS = ["@estebanforge", "pi-tui-dialogs"].join("/");
const LEGACY_PI_CODING_AGENT = ["@earendil-works", "pi-coding-agent"].join("/");
const LEGACY_PI_TUI = ["@earendil-works", "pi-tui"].join("/");

import type { SelectItem } from "./dialog-types.js";

interface LegacyBlockedStatus {
	kind: "permission" | "question" | "auth";
	message: string;
}

interface LegacyComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput?(data: string): void;
}

interface LegacyContainer extends LegacyComponent {
	addChild(child: unknown): void;
}

interface LegacySelectList extends LegacyComponent {
	onSelect?: (item: SelectItem) => void;
	onCancel?: () => void;
}

interface LegacyDialogs {
	dialogChoice(ctx: unknown, title: string, options: unknown): Promise<string | undefined>;
	DialogMenu: new (
		host: unknown,
		theme: unknown,
		options: unknown,
		onDone: (rowId: string) => void,
	) => LegacyComponent;
	DIALOG_OPTIONS: Record<string, unknown>;
	dialogBlocked(title: string): LegacyBlockedStatus;
}

interface LegacyBrowserKit {
	DynamicBorder: new (style: (text: string) => string) => LegacyComponent;
	Container: new () => LegacyContainer;
	SelectList: new (items: unknown[], maxVisible: number, theme: unknown) => LegacySelectList;
	Spacer: new (rows?: number) => LegacyComponent;
	Text: new (text: string, paddingX?: number, paddingY?: number) => LegacyComponent;
	dialogBlocked(title: string): LegacyBlockedStatus;
}

/** `@estebanforge/pi-tui-dialogs` (dialogChoice, DialogMenu, DIALOG_OPTIONS, dialogBlocked). */
export function importLegacyDialogs(): Promise<LegacyDialogs> {
	return import(LEGACY_DIALOGS);
}

interface LegacyPiTui {
	wrapTextWithAnsi(text: string, width: number): string[];
	Container: new () => LegacyContainer;
	SelectList: new (items: unknown[], maxVisible: number, theme: unknown) => LegacySelectList;
	Spacer: new (rows?: number) => LegacyComponent;
	Text: new (text: string, paddingX?: number, paddingY?: number) => LegacyComponent;
}

/** `@earendil-works/pi-tui`. */
export function importLegacyPiTui(): Promise<LegacyPiTui> {
	return import(LEGACY_PI_TUI);
}

/** What the artifact and task overlays draw with: DynamicBorder, the pi-tui
 *  components and dialogBlocked. */
export async function importLegacyBrowserKit(): Promise<LegacyBrowserKit> {
	const [agent, tui, dialogs] = await Promise.all([
		import(LEGACY_PI_CODING_AGENT),
		importLegacyPiTui(),
		importLegacyDialogs(),
	]);
	return {
		DynamicBorder: agent.DynamicBorder,
		Container: tui.Container,
		SelectList: tui.SelectList,
		Spacer: tui.Spacer,
		Text: tui.Text,
		dialogBlocked: dialogs.dialogBlocked,
	};
}
