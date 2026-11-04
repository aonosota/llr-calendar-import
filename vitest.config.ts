import { defineConfig } from "vitest/config";

// Pure modules compute in local time; pin a TZ so tests are deterministic.
process.env.TZ = "Asia/Tokyo";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
