import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  preview: { proxy: { '/api': process.env.ALFA_TEST_API_TARGET || 'http://127.0.0.1:4000' } },
  server: {
    port: 5173,
    proxy: { "/api": process.env.ALFA_TEST_API_TARGET || "http://127.0.0.1:4000" }
  }
});
