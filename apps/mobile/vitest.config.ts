import { defineConfig } from "vitest/config";

/* Only the pure modules under src/lib are tested here; anything importing
 * React Native stays out of the Node test run. */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
