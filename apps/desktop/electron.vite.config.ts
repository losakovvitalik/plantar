import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    // Внешним остаётся только рантайм-«dependencies» (ssh2) — всё остальное,
    // включая workspace-пакеты, бандлится и в упакованное приложение не попадает.
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
