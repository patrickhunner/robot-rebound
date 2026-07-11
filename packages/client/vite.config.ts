import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/socket.io": { target: process.env.VITE_DEV_SERVER_TARGET ?? "http://localhost:3001", ws: true },
      "/health": process.env.VITE_DEV_SERVER_TARGET ?? "http://localhost:3001"
    }
  }
});
