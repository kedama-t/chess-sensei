# ♞ Chess Sensei

Gemma E2B のオンデバイス推論（MediaPipe LLM Inference）で対局・解説してくれる、フロントエンドのみのチェス学習 Web アプリ。推論はすべてブラウザ内（WebGPU）で完結し、サーバーは不要です。

## 機能

- **Gemma との対局** — LLM が黒番として指し手を選択（非合法手はヒューリスティックでフォールバック）
- **自動アドバイス** — あなたの一手ごとにコーチがワンポイント解説（ON/OFF 可）
- **ヒント** — 局面の説明・おすすめの手・避けたい手を解説
- **無制限の「まった」** — 何手でも戻せる
- **思考過程の開示** — AI の思考を「思考」タブでいつでも閲覧
- **レスポンシブ UI** — スマホ・PC 両対応

## 開発

```bash
bun install
bun run dev
```

## モデル

初回起動時に Gemma の `.task` / `.litertlm` モデルを読み込みます。

- URL 指定（CORS 許可されたホストが必要。読み込み後は Cache API にキャッシュ）
- ローカルファイル選択（Hugging Face から手動ダウンロードした場合はこちら）

推奨: [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) の `gemma-4-E2B-it-web.task`（非ゲートなので URL から直接ロード可能）

### 推論バックエンド

- **GPU（WebGPU）** — 推奨。Chrome / Edge / Safari 26+ で利用可能
- **CPU** — WebGPU 非対応ブラウザ向け。CPU 対応モデル（int4/int8 量子化の `.task` など）が必要で、GPU 用（web 版）の `.task` は動作しません。読み込み画面でバックエンドを選択できます（デフォルトは自動判定）

## デプロイ

`main` に push すると GitHub Actions が GitHub Pages へ自動デプロイします（リポジトリ設定で Pages のソースを "GitHub Actions" にしてください）。
