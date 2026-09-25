import { configDefaults, defineConfig } from "vitest/config";

/* Only the pure modules under src/lib are tested here; anything importing
 * React Native stays out of the Node test run. Tests needing a running
 * server (*.int.test.ts) run separately, with `npm run test:sync`. */
export default defineConfig({
  test: {
    include: process.env.INTEGRATION ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
    exclude: process.env.INTEGRATION ? configDefaults.exclude : [...configDefaults.exclude, "src/**/*.int.test.ts"],
  },
});
