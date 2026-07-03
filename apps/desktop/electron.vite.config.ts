import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [
      // Workspace-пакеты — это TypeScript-исходники, их нужно бандлить;
      // ssh2 остаётся внешним (обычный node-модуль).
      externalizeDepsPlugin({ exclude: ["@plantar/core", "@plantar/ssh"] }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
