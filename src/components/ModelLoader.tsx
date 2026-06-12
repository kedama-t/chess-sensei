import { useRef, useState } from "react";
import {
  hasWebGpu,
  loadModel,
  type Backend,
  type LoadProgress,
} from "../llm/engine";

const DEFAULT_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task";

type Props = { onReady: () => void };

/** Gemma モデルの読み込み画面（URL またはローカルファイル） */
export function ModelLoader({ onReady }: Props) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [backend, setBackend] = useState<Backend>("auto");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const webGpu = hasWebGpu();

  const start = async (source: string | File) => {
    setError(null);
    try {
      await loadModel(source, setProgress, backend);
      onReady();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loading = progress !== null;
  const pct =
    progress?.phase === "download" && progress.total
      ? Math.round((progress.loaded! / progress.total) * 100)
      : null;

  const phaseLabel = {
    wasm: "ランタイムを準備中…",
    download: pct !== null ? `モデルをダウンロード中… ${pct}%` : "モデルをダウンロード中…",
    init: "モデルを初期化中…（しばらくかかります）",
    ready: "準備完了！",
  }[progress?.phase ?? "wasm"];

  return (
    <div className="loader">
      <h1>♞ Chess Sensei</h1>
      <p className="loader-sub">
        Gemma のオンデバイス推論で対局・解説するチェス学習アプリ。
        モデルはブラウザ内だけで動き、外部に送信されません。
      </p>

      {loading ? (
        <div className="loader-progress">
          <p>{phaseLabel}</p>
          {pct !== null && (
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      ) : (
        <>
          <label className="loader-label">
            モデル URL（Gemma の .task / .litertlm）
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/gemma.task"
            />
          </label>
          <label className="loader-label">
            推論バックエンド
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value as Backend)}
            >
              <option value="auto">
                自動（{webGpu ? "GPU を使用" : "WebGPU 非対応のため CPU"}）
              </option>
              <option value="GPU" disabled={!webGpu}>
                GPU（WebGPU）
              </option>
              <option value="CPU">CPU</option>
            </select>
          </label>
          {(backend === "CPU" || (backend === "auto" && !webGpu)) && (
            <p className="loader-note">
              CPU 推論には CPU 対応のモデル（int4/int8 量子化の .task など）が
              必要です。GPU 用（web 版）の .task は動作しません。
            </p>
          )}
          <button className="primary" onClick={() => start(url)}>
            URL から読み込む
          </button>
          <button onClick={() => fileRef.current?.click()}>
            ローカルファイルを選択
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".task,.litertlm,.bin"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) start(f);
            }}
          />
          <p className="loader-note">
            Hugging Face のモデルは認証が必要な場合があります。その場合は一度
            ダウンロードして「ローカルファイルを選択」から読み込んでください。
            2回目以降はブラウザにキャッシュされます。
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
