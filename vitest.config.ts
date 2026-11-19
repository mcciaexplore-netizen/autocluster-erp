import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    // Database test files share one test database, so test files run one at a time.
    fileParallelism: false,
    projects: [
      { extends: true, test: { name: "unit", include: ["lib/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "db",
          include: ["tests/**/*.db.test.ts"],
          globalSetup: ["tests/db-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
