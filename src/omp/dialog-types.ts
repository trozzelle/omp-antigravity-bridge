// Structural copies of the pi dialog kit's shapes. OMP's extension graph
// walker refuses even type-only imports of `@earendil-works/pi-tui` and of the
// dialog kit (legacy-ui.ts), so graph-reachable modules must not name them.
// The kit accepts these shapes unchanged.

export interface SelectItem {
	value: string;
	label: string;
	description?: string;
}

export interface ChoiceOption {
	value: string;
	label: string;
	description?: string;
}

export interface DialogRow {
	id: string;
	label: string;
	description?: string;
	currentValue: string;
	values?: string[];
}

export interface DialogContext {
	hasUI: boolean;
	mode?: string;
	ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
		custom<T>(factory: unknown, options?: unknown): Promise<T>;
	};
}
