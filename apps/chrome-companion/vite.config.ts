import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest: unknown = JSON.parse(
  readFileSync(path.join(directory, "manifest.json"), "utf8"),
);
if (
  typeof manifest !== "object" ||
  manifest === null ||
  !("minimum_chrome_version" in manifest) ||
  typeof manifest.minimum_chrome_version !== "string" ||
  !/^\d+$/u.test(manifest.minimum_chrome_version)
) {
  throw new Error("invalid_minimum_chrome_version");
}
export default defineConfig({
  root: path.join(directory, "src/popup"),
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(directory, "../ui-layer/src") } },
  build: {
    outDir: path.join(directory, "dist/popup"),
    emptyOutDir: true,
    target: `chrome${manifest.minimum_chrome_version}`,
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
