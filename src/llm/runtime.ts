/**
 * 解説文の生成に使うオンデバイス LLM（MediaPipe LLM Inference / Gemma）。
 * 指し手の選択と評価は Stockfish が担当するため、この LLM は
 * 「エンジンの解析結果を日本語で説明する」用途にだけ使う。未ロードでも
 * アプリは動く（テンプレート文にフォールバックする）。
 */
import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/wasm";

/** モデルキャッシュ名。破損キャッシュを捨てたいときはバージョンを上げる */
const MODEL_CACHE = "chess-sensei-model-v2";

/**
 * 自動ロードする Gemma 軽量モデル（MediaPipe LLM Inference 用）。
 * Gemma 3n E2B の web 版 .task（約 2GB）。非ゲートなので認証なしで
 * URL から直接ロードできる。1B などより軽量なモデルは HF でゲートされ
 * 認証が必要なため、認証不要で自動ロードできる中ではこれが最軽量。
 */
export const DEFAULT_MODEL_URL =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.task";

export type LoadProgress = {
  phase: "wasm" | "download" | "init" | "ready";
  loaded?: number;
  total?: number;
};

export type Backend = "auto" | "GPU" | "CPU";

let llm: LlmInference | null = null;

/** WebGPU が利用可能か */
export function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** auto を実際のデリゲートに解決する */
function resolveDelegate(backend: Backend): "GPU" | "CPU" {
  if (backend === "auto") return hasWebGpu() ? "GPU" : "CPU";
  return backend;
}

export function isReady(): boolean {
  return llm !== null;
}

/** モデル URL またはローカルファイルから LLM を初期化する */
export async function loadModel(
  source: string | File,
  onProgress: (p: LoadProgress) => void,
  backend: Backend = "auto",
): Promise<void> {
  const delegate = resolveDelegate(backend);
  if (delegate === "GPU" && !hasWebGpu()) {
    throw new Error(
      "このブラウザは WebGPU に未対応です。バックエンドを CPU にして、CPU 対応モデルを読み込んでください。",
    );
  }
  onProgress({ phase: "wasm" });
  const genai = await FilesetResolver.forGenAiTasks(WASM_URL);

  let modelBlobUrl: string;
  if (source instanceof File) {
    modelBlobUrl = URL.createObjectURL(source);
  } else {
    const blob = await fetchWithProgress(source, onProgress);
    modelBlobUrl = URL.createObjectURL(blob);
  }

  onProgress({ phase: "init" });
  llm = await LlmInference.createFromOptions(genai, {
    baseOptions: { modelAssetPath: modelBlobUrl, delegate },
    maxTokens: 1024,
    temperature: 0.3,
    topK: 20,
  });
  cur = { temperature: 0.3, topK: 20 };
  onProgress({ phase: "ready" });
}

/** ダウンロード進捗を通知しつつモデルを取得（Cache API でキャッシュ） */
async function fetchWithProgress(
  url: string,
  onProgress: (p: LoadProgress) => void,
): Promise<Blob> {
  const cache = await caches.open(MODEL_CACHE).catch(() => null);
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress({ phase: "download", loaded: 1, total: 1 });
      return hit.blob();
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`モデルの取得に失敗しました (${res.status})`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ phase: "download", loaded, total });
  }
  // ダウンロードが途中で切れていないか検証（破損キャッシュを防ぐ）
  if (total && loaded !== total) {
    throw new Error(
      `モデルのダウンロードが不完全です（${loaded}/${total} バイト）。再試行してください。`,
    );
  }
  const blob = new Blob(chunks as BlobPart[]);
  if (cache) {
    await cache.put(url, new Response(blob)).catch(() => {});
  }
  return blob;
}

/** Gemma のチャットテンプレートでプロンプトを囲む */
function toGemmaChat(prompt: string): string {
  return `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`;
}

/** タスクごとのサンプリング設定 */
export type Sampling = { temperature: number; topK: number };

let cur: Sampling | null = null;

/** 直近の設定と異なる場合のみ setOptions を呼ぶ（再初期化コストを避ける） */
async function applySampling(s?: Sampling): Promise<void> {
  if (!s || !llm) return;
  if (cur && cur.temperature === s.temperature && cur.topK === s.topK) return;
  try {
    await llm.setOptions({ temperature: s.temperature, topK: s.topK });
    cur = s;
  } catch {
    // 設定変更に失敗しても現状の設定で生成を続行する
  }
}

/** 末尾が短い単位の繰り返しになっていればループとみなす */
function loopUnitEnd(text: string): number {
  const tail = text.slice(-280);
  if (tail.length < 60) return 0;
  for (let p = 2; p <= 40; p++) {
    const unit = tail.slice(-p);
    if (!unit.trim()) continue;
    let count = 1;
    let i = tail.length - p;
    while (i - p >= 0 && tail.slice(i - p, i) === unit) {
      count++;
      i -= p;
    }
    if (count >= 4) return p;
  }
  return 0;
}

/** 繰り返している末尾を 1 単位だけ残して削る */
function trimLoop(text: string): string {
  const p = loopUnitEnd(text);
  if (!p) return text;
  const unit = text.slice(-p);
  let i = text.length - p;
  while (i - p >= 0 && text.slice(i - p, i) === unit) i -= p;
  return text.slice(0, i + p).trimEnd();
}

/**
 * ストリーミング生成。onToken で逐次テキストを返す。
 * 末尾の繰り返し（トークンループ）を検出したら生成を打ち切る。
 */
export async function generate(
  prompt: string,
  opts: { onToken?: (partial: string) => void; sampling?: Sampling } = {},
): Promise<string> {
  if (!llm) throw new Error("モデルが読み込まれていません");
  const { onToken, sampling } = opts;
  await applySampling(sampling);

  return new Promise((resolve, reject) => {
    let acc = "";
    let cancelled = false;
    try {
      llm!.generateResponse(toGemmaChat(prompt), (partial, done) => {
        acc += partial;
        onToken?.(acc);
        if (done) {
          resolve(trimLoop(acc));
          return;
        }
        // ループ検出時は生成を打ち切る（このランタイムに無い API は呼ばない）
        if (!cancelled && loopUnitEnd(acc) && typeof llm!.cancelProcessing === "function") {
          cancelled = true;
          llm!.cancelProcessing();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}
