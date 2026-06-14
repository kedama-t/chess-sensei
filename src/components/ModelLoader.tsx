import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MODEL_URL,
  hasWebGpu,
  loadModel,
  type LoadProgress,
} from "../llm/engine";

type Props = { onReady: () => void };

/** Gemma 軽量モデルを起動時に自動ロードする画面（失敗時のみ手動フォールバック） */
export function ModelLoader({ onReady }: Props) {
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const webGpu = hasWebGpu();

  const start = async (source: string | File) => {
    setError(null);
    setProgress({ phase: "wasm" });
    try {
      await loadModel(source, setProgress, "auto");
      onReady();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // 起動時に既定の軽量モデルを自動ロード
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start(DEFAULT_MODEL_URL);
  }, []);

  const pct =
    progress?.phase === "download" && progress.total
      ? Math.round((progress.loaded! / progress.total) * 100)
      : null;

  const phaseLabel = {
    wasm: "ランタイムを準備中…",
    download:
      pct !== null ? `モデルをダウンロード中… ${pct}%` : "モデルをダウンロード中…",
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

      {error === null ? (
        <div className="loader-progress">
          <p>{phaseLabel}</p>
          {pct !== null && (
            <div className="bar">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className="loader-note">
            初回はモデル（約 2GB）をダウンロードします。2回目以降は
            ブラウザにキャッシュされ、すぐに起動します。
            {!webGpu &&
              " このブラウザは WebGPU 非対応のため CPU で動作します。"}
          </p>
        </div>
      ) : (
        <>
          <p className="error">モデルの自動読み込みに失敗しました。</p>
          <p className="error">{error}</p>
          <button className="primary" onClick={() => start(DEFAULT_MODEL_URL)}>
            再試行
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
              if (f) void start(f);
            }}
          />
          <p className="loader-note">
            ダウンロードに失敗する場合は、Gemma の .task モデルを手動で
            ダウンロードして「ローカルファイルを選択」から読み込んでください。
          </p>
        </>
      )}
    </div>
  );
}
