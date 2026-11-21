import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	bridgedPiTools,
	formatBridgeToolInfo,
	parseBridgeCallRequest,
	serializeToolSchema,
	type BridgeToolInfo,
} from "../../src/bridge-catalog.js";
import { __setHostForTests } from "../../src/omp/host.js";
import { toPlainJsonSchema } from "../../src/omp/tool-schema.js";

const FALLBACK = { type: "object", properties: {}, additionalProperties: true };

/** OMP tool parameters: a callable omptype schema whose JSON form exists only
 *  behind toJsonSchema() (JSON.stringify of the function yields undefined). */
function ompSchema(toJsonSchema: (options?: { io?: "input" | "output" }) => Record<string, unknown>): object {
	const schema = (value: unknown): unknown => value;
	return Object.assign(schema, { toJsonSchema });
}

const names = (tools: readonly BridgeToolInfo[]): string[] => tools.map((tool) => tool.name);

afterEach(() => __setHostForTests(undefined));

describe("OMP tool schemas reach agy", () => {
	beforeEach(() => __setHostForTests("omp"));

	const secretSchema = {
		type: "object",
		properties: { zq_token: { type: "string", description: "Must be ZEBRA." } },
		required: ["zq_token"],
	};

	it("serializes a callable OMP schema instead of the empty fallback", () => {
		expect(serializeToolSchema(ompSchema(() => secretSchema))).toEqual(secretSchema);
	});

	it("shows real parameter names in bridge_tool_info", () => {
		const tools: BridgeToolInfo[] = [
			{ name: "secret_probe", description: "Needs a token.", parameters: ompSchema(() => secretSchema) },
		];
		const text = formatBridgeToolInfo(tools, ["secret_probe"]).content[0].text;
		expect(text).toContain('"zq_token"');
		expect(text).toContain('"required"');
	});

	it("describes what the tool accepts, not what a transformed field becomes", () => {
		const morph = ompSchema((options) => ({
			type: "object",
			properties: { when: options?.io === "input" ? { type: "string" } : { type: "number" } },
		}));
		expect(serializeToolSchema(morph)).toEqual({ type: "object", properties: { when: { type: "string" } } });
	});

	it("falls back to the permissive schema when toJsonSchema throws", () => {
		const broken = ompSchema(() => {
			throw new TypeError("Cannot convert a symbol to a string");
		});
		expect(serializeToolSchema(broken)).toEqual(FALLBACK);
	});
});

describe("plain schemas (pi TypeBox / raw JSON)", () => {
	beforeEach(() => __setHostForTests("pi"));

	it("pass through toPlainJsonSchema untouched", () => {
		const plain = { type: "object", properties: { q: { type: "string" } } };
		expect(toPlainJsonSchema(plain)).toBe(plain);
		expect(serializeToolSchema(plain)).toEqual(plain);
	});
});

describe("OMP bridge catalog selection", () => {
	beforeEach(() => __setHostForTests("omp"));

	const ompTools: BridgeToolInfo[] = [
		{ name: "echo_probe", sourceInfo: { source: "extension", path: "/w/probe.ts" } },
		{
			name: "mcp__github_search_issues",
			sourceInfo: { source: "mcp", path: "<mcp:mcp__github_search_issues>" },
			mcpServerName: "github",
		},
		{
			name: "files_read",
			sourceInfo: { source: "extension", path: "/home/u/.omp/plugins/node_modules/pi-mcp-adapter/index.ts" },
		},
		{ name: "resolve", sourceInfo: { source: "extension", path: "<extension:resolve>" } },
		{ name: "propose", sourceInfo: { source: "extension", path: "<extension:propose>" } },
		{ name: "run_experiment", sourceInfo: { source: "extension", path: "<extension:run_experiment>" } },
		// A `.omp/tools` custom tool: synthetic path, but a user tool.
		{ name: "deploy_preview", sourceInfo: { source: "extension", path: "<extension:deploy_preview>" } },
		{ name: "read", sourceInfo: { source: "builtin", path: "<builtin:read>" } },
	];
	const active = names(ompTools);

	it("mcp mode bridges OMP-native MCP tools and legacy pi-mcp-adapter tools", () => {
		expect(names(bridgedPiTools(ompTools, active, "mcp", new Set()))).toEqual([
			"mcp__github_search_issues",
			"files_read",
		]);
	});

	it("all mode never bridges OMP session-control tools but keeps user custom tools", () => {
		expect(names(bridgedPiTools(ompTools, active, "all", new Set()))).toEqual([
			"echo_probe",
			"mcp__github_search_issues",
			"files_read",
			"deploy_preview",
		]);
	});

	it("still bridges a file-backed extension tool that happens to be named resolve", () => {
		const own: BridgeToolInfo[] = [{ name: "resolve", sourceInfo: { source: "extension", path: "/w/my-ext.ts" } }];
		expect(names(bridgedPiTools(own, ["resolve"], "all", new Set()))).toEqual(["resolve"]);
	});

	it("refuses a bridge_call_tool dispatch of a harness tool", () => {
		const authorized = bridgedPiTools(ompTools, active, "all", new Set());
		const res = parseBridgeCallRequest({ name: "resolve", arguments_json: '{"reason":"ship it"}' }, authorized);
		expect(res.ok).toBe(false);
	});
});

describe("pi catalog selection is unchanged", () => {
	beforeEach(() => __setHostForTests("pi"));

	it("mcp mode matches only the pi-mcp-adapter source", () => {
		const piTools: BridgeToolInfo[] = [
			{ name: "mcp:files", sourceInfo: { source: "pi-mcp-adapter" } },
			{ name: "odd", sourceInfo: { source: "mcp" }, mcpServerName: "x" },
			{ name: "resolve", sourceInfo: { source: "extension", path: "<extension:resolve>" } },
		];
		expect(names(bridgedPiTools(piTools, names(piTools), "mcp", new Set()))).toEqual(["mcp:files"]);
		expect(names(bridgedPiTools(piTools, names(piTools), "all", new Set()))).toEqual(["mcp:files", "odd", "resolve"]);
	});
});
