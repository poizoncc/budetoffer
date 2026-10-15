import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/ui-layer/src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./apps/ui-layer/src/shared/ui/test-setup.ts"],
    include: ["apps/ui-layer/src/pages/companion-popup/**/*.test.{ts,tsx}"],
  },
});
