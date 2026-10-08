import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",
      thresholds: { perFile: true, lines: 100, functions: 100 },
    },
  },
});
