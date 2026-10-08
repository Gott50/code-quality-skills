import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["**/*-bin.ts"],
      include: ["src/**/*.ts"],
      provider: "istanbul",
      reporter: ["text", "json"],
      thresholds: { functions: 100, lines: 100, perFile: true },
    },
  },
});
