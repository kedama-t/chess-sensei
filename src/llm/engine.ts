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
    maxTokens: 1280,
    temperature: 0.6,
    topK: 40,
  });
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

/** ストリーミング生成。onToken で逐次テキストを返す */
export function generate(
  prompt: string,
  onToken?: (partial: string) => void,
): Promise<string> {
  if (!llm) throw new Error("モデルが読み込まれていません");
  return new Promise((resolve, reject) => {
    let acc = "";
    try {
      llm!.generateResponse(toGemmaChat(prompt), (partial, done) => {
        acc += partial;
        onToken?.(acc);
        if (done) resolve(acc);
      });
    } catch (e) {
      reject(e);
    }
  });
}
