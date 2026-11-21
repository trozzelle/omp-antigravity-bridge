// OMP 19 tool parameters are callable omptype schemas: JSON.stringify of the
// function yields undefined, so the bridge's JSON clone produced an empty
// schema for every tool. Their JSON Schema comes from `toJsonSchema()`.
// pi's TypeBox schemas are plain JSON objects and pass through untouched.

/** Lower a tool's `parameters` to a plain JSON Schema value for MCP exposure.
 *  Returns `parameters` unchanged when it has no callable `toJsonSchema`, and
 *  undefined when the conversion throws (callers fall back to a permissive schema). */
export function toPlainJsonSchema(parameters: unknown): unknown {
	if (typeof parameters === "function" || (typeof parameters === "object" && parameters !== null)) {
		if (!("toJsonSchema" in parameters)) return parameters;
		const toJsonSchema: unknown = parameters.toJsonSchema;
		if (typeof toJsonSchema !== "function") return parameters;
		try {
			// agy fills these arguments in, so describe what the tool accepts
			// (morph inputs), not what validation produces.
			const schema: unknown = toJsonSchema.call(parameters, { io: "input" });
			return schema;
		} catch {
			return undefined;
		}
	}
	return parameters;
}
