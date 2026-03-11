import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli/**",
        "src/index.ts",
        "src/**/index.ts",
        "src/types.ts",
        "src/vendor.d.ts",
        "src/parser/types.ts"
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95
      }
    }
  }
});
