import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every API test runs against the same PostgreSQL database, so test files
    // must not run concurrently: one file's fixture writes would otherwise be
    // visible to another file mid-assertion. Isolation comes from each file
    // owning its own throwaway rows; this setting keeps that isolation real.
    fileParallelism: false,
  },
});
