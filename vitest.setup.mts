// getAgentDir() prefers PI_CODING_AGENT_DIR over HOME, so an exported value on a
// developer machine or CI runner would point suites at a real agent dir. Pin a
// throwaway dir per worker; suites needing a layout set their own and restore it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "vitest-agentdir-"));
