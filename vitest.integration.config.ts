import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    reporters: "default",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Booking tests share one database; run files serially to avoid cross-talk.
    fileParallelism: false,
  },
});
