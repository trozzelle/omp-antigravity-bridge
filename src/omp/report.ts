// Command reports that must reach the user in every mode.
//
// ctx.ui.notify is a no-op without a UI, so in print mode (`-p "/agy doctor"`)
// a notify-only report vanishes. Print mode owns stdout and nothing else
// writes to it during an extension command, so the report goes there.
// RPC and JSON modes keep notify: their stdout is a protocol stream.

export interface ReportContext {
	hasUI: boolean;
	mode: string;
	ui?: { notify(message: string, type?: "info" | "warning" | "error"): void };
}

export function showReport(ctx: ReportContext, text: string, write: (chunk: string) => void = (chunk) => void process.stdout.write(chunk)): void {
	if (!ctx.hasUI && ctx.mode === "print") {
		write(`${text}\n`);
		return;
	}
	ctx.ui?.notify(text, "info");
}
