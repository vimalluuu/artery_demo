import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  // Avoid a first-use dependency optimization reload when opening the lazy viewer.
  optimizeDeps: { include: ['@niivue/niivue', 'nifti-reader-js', 'fflate'] },
  server: {
    port: 5173,
    proxy: {
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
