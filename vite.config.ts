import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Rust build output must not be watched (Windows locks .exe files).
    watch: { ignored: ["**/src-tauri/**", "**/.freebuff/**"] },
  },
  build: { target: "es2022" },
});
