import { useRef } from "react";
import type { LoadProgress } from "../llm/runtime";
import type { LlmStatus } from "../llm/useLlm";

type Props = {
  status: LlmStatus;
  progress: LoadProgress | null;
  error: string | null;
  onEnable: (source?: string | File) => void;
  onDisable: () => void;
};

function phaseLabel(progress: LoadProgress | null): string {
  const pct =
    progress?.phase === "download" && progress.total
      ? Math.round((progress.loaded! / progress.total) * 100)
      : null;
  switch (progress?.phase) {
    case "download":
      return pct !== null ? `モデルをダウンロード中… ${pct}%` : "モデルをダウンロード中…";
    case "init":
      return "モデルを初期化中…（しばらくかかります）";
    case "ready":
      return "準備完了";
    default:
      return "ランタイムを準備中…";
  }
}

/**
 * 解説 AI（Gemma）の有効化 UI。
 * 無効でも Stockfish の解析結果によるテンプレート解説でアプリは動く。
 */
export function LlmPanel({ status, progress, error, onEnable, onDisable }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pct =
    progress?.phase === "download" && progress.total
      ? Math.round((progress.loaded! / progress.total) * 100)
      : null;

  if (status === "loading") {
    return (
      <div className="llm-panel">
        <p className="llm-line">{phaseLabel(progress)}</p>
        {pct !== null && (
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="llm-panel">
        <p className="llm-line">
          🗣 AI 解説: 有効（Stockfish の分析に続けて、Gemma がブラウザ内で解説文を作成）
        </p>
        <button onClick={onDisable}>AI 解説を止める（分析のみにする）</button>
      </div>
    );
  }

  return (
    <div className="llm-panel">
      {status === "error" && <p className="error">AI 解説の読み込みに失敗しました: {error}</p>}
      <p className="llm-line">
        いまは Stockfish の分析だけを表示しています。AI 解説を有効にすると、その下に
        同じ分析結果をやさしい日本語で説明した文章が追加されます（初回のみ約 2GB の
        モデルをダウンロード）。
      </p>
      <div className="llm-actions">
        <button className="primary" onClick={() => onEnable()}>
          {status === "error" ? "再試行" : "AI 解説を有効にする"}
        </button>
        {status === "error" && (
          <button onClick={() => fileRef.current?.click()}>ローカルの .task を選ぶ</button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".task,.litertlm,.bin"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onEnable(f);
        }}
      />
    </div>
  );
}
