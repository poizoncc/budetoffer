import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(directory, "src/popup"),
  base: "./",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(directory, "../ui-layer/src") } },
  build: {
    outDir: path.join(directory, "dist/popup"),
    emptyOutDir: true,
    target: "chrome120",
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
