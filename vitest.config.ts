import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./vitest.setup.mts"],
		isolate: true,
		include: ["tests/**/*.test.ts"],
	},
});
