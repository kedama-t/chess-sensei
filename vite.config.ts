import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages のサブパス配信に対応
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/chess-sensei/" : "/",
  plugins: [react()],
});
