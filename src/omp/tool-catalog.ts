// OMP-specific bridge catalog selection. See OMP's getAllToolInfos():
// source is "builtin" | "mcp" | "sdk" | "extension"; sourceInfo.path is the
// registering file or a synthetic `<source:name>` placeholder.
import { isOmpHost } from "./host.js";

export interface OmpCatalogTool {
	name: string;
	sourceInfo?: { source?: string; path?: string };
	mcpServerName?: string;
}

/** OMP harness tools that drive the OMP session itself: applying or
 *  discarding a staged action, proposing a plan, filing tool issues, and
 *  the autoresearch loop. agy must never call them through the bridge.
 *  OMP 19.1: tools/resolve.ts specialToolCommands, autoresearch EXPERIMENT_TOOL_NAMES. */
export const OMP_HARNESS_TOOL_NAMES: ReadonlySet<string> = new Set([
	"resolve",
	"reject",
	"propose",
	"report_issue",
	"init_experiment",
	"run_experiment",
	"log_experiment",
	"update_notes",
]);

/** A harness tool carries one of the names above AND the synthetic
 *  `<extension:NAME>` path (no file registered it). A same-named tool from a
 *  real extension file is a user tool and stays bridgeable. */
export function isOmpHarnessTool(tool: OmpCatalogTool): boolean {
	if (!isOmpHost() || !OMP_HARNESS_TOOL_NAMES.has(tool.name)) return false;
	return tool.sourceInfo?.source === "extension" && tool.sourceInfo.path === `<extension:${tool.name}>`;
}

/** `bridgeTools: mcp` under OMP: OMP-native MCP tools (`source: "mcp"`, or an
 *  MCP server name on the tool) and legacy pi-mcp-adapter tools, which OMP
 *  reports as `source: "extension"` with the adapter's file path. */
export function isOmpMcpTool(tool: OmpCatalogTool): boolean {
	if (!isOmpHost()) return false;
	return (
		tool.sourceInfo?.source === "mcp" ||
		typeof tool.mcpServerName === "string" ||
		/pi-mcp-adapter/.test(tool.sourceInfo?.path ?? "")
	);
}
