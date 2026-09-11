# ♞ Chess Sensei

**Stockfish が指して評価し、LLM は解説だけを担当する**フロントエンドのみのチェス学習 Web アプリ。
対局・解析・解説のすべてがブラウザ内で完結し、サーバーは不要です。

## 役割分担

| 担当 | 使うもの | やること |
| --- | --- | --- |
| 指し手・評価 | Stockfish 18（WebAssembly・シングルスレッド） | 相手としての着手、局面評価、最善手・読み筋の算出、悪手判定 |
| 説明 | Gemma（MediaPipe LLM Inference・任意） | Stockfish の解析結果を初心者向けの日本語に翻訳するだけ |

LLM に手を選ばせないので、非合法手や的外れな読み筋が出ません。LLM を有効にしていない
場合は、解析結果をそのまま整形したテンプレート解説になります（アプリはそれだけで成立します）。

## 機能

- **Stockfish との対局** — 強さは Elo 1350 / 1700 / 2200 / 制限なしから選択（`UCI_LimitStrength`）
- **一手ごとの講評** — 指す前後の評価値差（センチポーン）から 最善手 / good / 不正確 / 疑問手 / 大悪手 を判定し、最善手とその読み筋を提示
- **評価バー** — 現局面の形勢をリアルタイム表示
- **ヒント** — MultiPV 3 の候補手と読み筋、最善手を盤上に矢印表示
- **AI 解説（任意）** — 上記の解析結果だけを根拠に、Gemma がやさしい日本語で説明
- **無制限の「まった」／棋譜／解析タブ**
- **レスポンシブ UI** — スマホ・PC 両対応

## チェスエンジン

[stockfish.js](https://github.com/nmrugg/stockfish.js) の `stockfish-18-lite-single`（約 7MB）を
Web Worker で動かします。

- **シングルスレッド版を使う理由**: GitHub Pages のような静的ホスティングでは COOP/COEP
  ヘッダを付けられず、マルチスレッド版が必要とする `SharedArrayBuffer` が使えないため
- npm パッケージ `stockfish` から `public/engine/` へ、Vite プラグイン（`vite.config.ts`）が
  自動でコピーします（`public/engine/` は .gitignore 済み）
- UCI ラッパーは `src/engine/uci.ts`、評価値の正規化・悪手判定は `src/engine/analysis.ts`

## 解説 LLM（任意）

コーチタブの「AI 解説を有効にする」を押すと、MediaPipe LLM Inference が Gemma を
ダウンロードして初期化します。一度有効にした端末では次回から自動で読み込みます。

- 既定モデル: [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) の `gemma-4-E2B-it-web.task`（約 2GB）
- モデルは Cache API にキャッシュされ、2 回目以降はすぐ起動
- WebGPU が使えれば GPU、なければ CPU を自動選択（既定モデルは web/GPU 版のため、
  WebGPU 非対応環境では読み込みに失敗します。その場合は CPU 対応の `.task` を
  「ローカルの .task を選ぶ」から読み込んでください）
- プロンプトでは「解析結果にない手・評価を書かない」ことを明示し、生成が失敗しても
  テンプレート解説にフォールバックします

## 開発

```bash
bun install
bun run dev     # http://localhost:5173
bun run build   # 型チェック + 本番ビルド
```

## デプロイ

`main` に push すると GitHub Actions が GitHub Pages へ自動デプロイします
（リポジトリ設定で Pages のソースを "GitHub Actions" にしてください）。
