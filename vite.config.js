import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: run `npm run dev` (Vite on 5173) alongside `node server.js` (API on 4173).
// The proxy forwards /api/* to the local Express server so the app works end-to-end
// in development. In production the same Express server serves dist/ AND /api.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4173",
    },
  },
});
