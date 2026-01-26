import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  ssr: false,
  server: { preset: "static" },
  vite: () => ({
    plugins: [tailwindcss()],
    server: {
      port: 1420,
      strictPort: true,
      host: true,
      hmr: {
        protocol: "ws",
        host: "localhost",
        port: 1420,
      },
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: "esnext",
    },
  }),
});
