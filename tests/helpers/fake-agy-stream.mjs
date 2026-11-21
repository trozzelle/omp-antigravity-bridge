// Fake stream-json agy for the OMP session tests (tests/omp/stream-sessions.test.ts).
//
// `--version` (also the `--gemini_dir <dir> --version` capability probe) prints
// a version; any other non-stream invocation (`models`) fails, so the extension
// takes its fallback catalog. A stream-json run serves every stdin turn on one
// process, like the real CLI: the reply is `<last prompt line> from <pid>`, and a
// prompt containing HOLD never settles. Each spawn (with its argv) and each
// SIGTERM exit lands in FAKE_AGY_LOG as one JSON line.

import fs from "node:fs";
import readline from "node:readline";

const argv = process.argv.slice(2);

function log(event, data = {}) {
	if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify({ event, pid: process.pid, ...data })}\n`);
}

if (argv.includes("--version")) {
	process.stdout.write("1.5.14\n");
	process.exit(0);
}
if (!argv.includes("--input-format")) process.exit(1);

const at = argv.indexOf("--conversation");
const conversation = at >= 0 ? argv[at + 1] : `conv-${process.pid}`;
log("spawn", { argv });
process.on("SIGTERM", () => {
	log("exit");
	process.exit(0);
});

const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	const content = JSON.parse(line)?.message?.content;
	const prompt = typeof content === "string" ? content : "";
	send({ event: "init", init: { conversation_id: conversation } });
	if (prompt.includes("HOLD")) return;
	const reply = `${prompt.trim().split("\n").pop()} from ${process.pid}`;
	send({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "agent_response", text_delta: reply } });
	send({
		event: "result",
		result: {
			status: "SUCCESS",
			response: reply,
			conversation_id: conversation,
			usage: { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 },
		},
	});
});
