import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["src/test/global-setup.ts"],
    setupFiles: ["src/test/setup.ts"],
    // One shared Postgres, and TRUNCATE between tests — so files must not race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    include: ["src/**/*.test.ts"],
  },
});
