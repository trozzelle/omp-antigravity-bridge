// Native re-exec under OMP: rewrite the pi-shaped builtin call from
// mapAgyToolToNative onto OMP's builtins. OMP `read` takes only `path` with
// inline 1-based inclusive selectors (`:N-M`, `:N-`) and also lists
// directories; OMP has no `ls` and its `find` is semantic search, so name
// search goes to `glob {path, pattern}` (pattern scoped under path).
import type { NativeToolCall } from "../native-tools.js";

/** Windows drive root (`C:\` or `C:/`): its colon is not a selector. */
const DRIVE_ROOT = /^[A-Za-z]:[\\/]/;

/** `path:START-END`, `path:START-` (to EOF), or the bare path. Undefined when
 *  the path already holds a colon: an appended range would be ambiguous. */
function rangedPath(path: string, offset: unknown, limit: unknown): string | undefined {
	if (typeof offset !== "number") return path;
	if (path.replace(DRIVE_ROOT, "").includes(":")) return undefined;
	const end = typeof limit === "number" ? String(offset + limit - 1) : "";
	return `${path}:${offset}-${end}`;
}

/** agy find_by_name / pi find match names at any depth; OMP glob scopes a
 *  bare `*.ts` under `path` to direct children only. */
function recursivePattern(pattern: string): string {
	return pattern.includes("/") ? pattern : `**/${pattern}`;
}

/** Map a pi builtin re-exec call onto OMP's builtins. Undefined means the
 *  step has no safe OMP form and must replay through the wrapper card. */
export function mapReexecForOmp(call: NativeToolCall): NativeToolCall | undefined {
	const { path, pattern } = call.args;
	switch (call.tool) {
		case "read": {
			if (typeof path !== "string") return undefined;
			const target = rangedPath(path, call.args.offset, call.args.limit);
			return target === undefined ? undefined : { tool: "read", args: { path: target } };
		}
		case "ls":
			return typeof path === "string" ? { tool: "read", args: { path } } : undefined;
		case "find": {
			if (typeof pattern !== "string") return undefined;
			if (typeof path !== "string") return { tool: "glob", args: { pattern } };
			return { tool: "glob", args: { path, pattern: recursivePattern(pattern) } };
		}
		default:
			return call;
	}
}
