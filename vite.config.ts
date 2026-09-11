import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** npm パッケージ stockfish から wasm ビルドを public/engine/ にコピーする */
function copyEngine(): void {
  const require = createRequire(import.meta.url);
  const binDir = join(dirname(require.resolve("stockfish/package.json")), "bin");
  const outDir = resolve(__dirname, "public/engine");
  mkdirSync(outDir, { recursive: true });
  for (const f of ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"]) {
    copyFileSync(join(binDir, f), join(outDir, f));
  }
}

/** Stockfish の wasm ビルドを public/engine/ に配置する（dev / build 共通） */
function stockfishAssets(): Plugin {
  // dev サーバーが public/ を配信し始める前に置いておく必要があるため、
  // 設定の読み込み時点でコピーする
  copyEngine();
  return { name: "stockfish-assets", buildStart: copyEngine };
}

// GitHub Pages のサブパス配信に対応
export default defineConfig({
  base: process.env.GITHUB_PAGES ? "/chess-sensei/" : "/",
  plugins: [react(), stockfishAssets()],
});
