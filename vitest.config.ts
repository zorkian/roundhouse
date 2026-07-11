import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "/tmp/roundhouse-vitest",
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
