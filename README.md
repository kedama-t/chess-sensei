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

モデルの指定は不要です。初回起動時に MediaPipe（LLM Inference）が Gemma の
軽量モデルを**自動でダウンロード・初期化**します。

- 既定モデル: [litert-community/gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm) の `gemma-4-E2B-it-web.task`（Gemma 3n E2B / 約 2GB）
- 非ゲートなので認証なしで URL から直接ロード可能。より軽量な Gemma 1B などは Hugging Face でゲートされ認証が必要なため、認証不要で自動ロードできる中ではこれが最軽量
- ダウンロードしたモデルは Cache API にキャッシュされ、2回目以降はすぐ起動
- ダウンロードに失敗した場合のみ、手動で `.task` を読み込むフォールバックを表示

### 推論バックエンド

WebGPU が使えれば GPU、なければ CPU を自動選択します（Chrome / Edge / Safari 26+ で WebGPU 利用可）。
既定モデルは web（GPU）版のため、WebGPU 非対応環境では動作しません。その場合は
フォールバックから CPU 対応モデル（int4/int8 量子化の `.task` など）を読み込んでください。

## デプロイ

`main` に push すると GitHub Actions が GitHub Pages へ自動デプロイします（リポジトリ設定で Pages のソースを "GitHub Actions" にしてください）。
