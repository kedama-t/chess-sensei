import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_MODEL_URL, isReady, loadModel, type LoadProgress } from "./runtime";

export type LlmStatus = "off" | "loading" | "ready" | "error";

const PREF_KEY = "chess-sensei:llm-explanations";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // プライベートモードなどで保存できなくても動作に影響はない
  }
}

/**
 * 解説用 LLM の読み込み状態を管理する。
 * モデルは約 2GB あるため既定では読み込まず、ユーザーが有効化したときだけ
 * ダウンロードする（一度有効にした端末では次回から自動で読み込む）。
 */
export function useLlm() {
  const [status, setStatus] = useState<LlmStatus>(() => (isReady() ? "ready" : "off"));
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);

  const enable = useCallback(async (source: string | File = DEFAULT_MODEL_URL) => {
    if (loading.current || isReady()) return;
    loading.current = true;
    setError(null);
    setStatus("loading");
    setProgress({ phase: "wasm" });
    try {
      await loadModel(source, setProgress, "auto");
      writePref(true);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      loading.current = false;
      setProgress(null);
    }
  }, []);

  /** 解説を使わない状態に戻す（読み込み済みモデルは破棄できないので次回から無効） */
  const disable = useCallback(() => {
    writePref(false);
    setStatus("off");
    setError(null);
  }, []);

  // 前回有効にしていた端末では自動で読み込む（モデルはキャッシュ済み）
  useEffect(() => {
    if (readPref() && !isReady()) void enable();
  }, [enable]);

  return { status, progress, error, enable, disable, ready: status === "ready" };
}
