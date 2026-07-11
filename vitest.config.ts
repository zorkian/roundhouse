import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/roundhouse-vitest",
  test: {
    include: ["packages/**/*.test.ts"],
  },
});
