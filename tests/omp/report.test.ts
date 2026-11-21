import { describe, expect, test } from "vitest";
import { showReport, type ReportContext } from "../../src/omp/report.js";

function ctx(hasUI: boolean, mode: string) {
	const notified: Array<{ message: string; type: string | undefined }> = [];
	const context: ReportContext = { hasUI, mode, ui: { notify: (message, type) => void notified.push({ message, type }) } };
	return { context, notified };
}

describe("showReport", () => {
	test("print mode without a UI prints the report to stdout", () => {
		const { context, notified } = ctx(false, "print");
		const written: string[] = [];
		showReport(context, "Antigravity doctor\n  engine: acp", (chunk) => written.push(chunk));
		expect(written).toEqual(["Antigravity doctor\n  engine: acp\n"]);
		expect(notified).toEqual([]);
	});

	test("the TUI gets a notification and nothing on stdout", () => {
		const { context, notified } = ctx(true, "tui");
		const written: string[] = [];
		showReport(context, "report", (chunk) => written.push(chunk));
		expect(notified).toEqual([{ message: "report", type: "info" }]);
		expect(written).toEqual([]);
	});

	test("headless RPC and JSON modes never write to their protocol stdout", () => {
		for (const mode of ["rpc", "json"]) {
			const { context, notified } = ctx(false, mode);
			const written: string[] = [];
			showReport(context, "report", (chunk) => written.push(chunk));
			expect(written).toEqual([]);
			expect(notified).toEqual([{ message: "report", type: "info" }]);
		}
	});
});
