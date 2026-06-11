import { FilesetResolver, LlmInference } from "@mediapipe/tasks-genai";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.21/wasm";

export type LoadProgress = {
  phase: "wasm" | "download" | "init" | "ready";
  loaded?: number;
  total?: number;
};

let llm: LlmInference | null = null;

export function isReady(): boolean {
  return llm !== null;
}

/** モデル URL またはローカルファイルから LLM を初期化する */
export async function loadModel(
  source: string | File,
  onProgress: (p: LoadProgress) => void,
): Promise<void> {
  onProgress({ phase: "wasm" });
  const genai = await FilesetResolver.forGenAiTasks(WASM_URL);

  let modelBlobUrl: string;
  if (source instanceof File) {
    modelBlobUrl = URL.createObjectURL(source);
  } else {
    const buf = await fetchWithProgress(source, onProgress);
    modelBlobUrl = URL.createObjectURL(new Blob([buf]));
  }

  onProgress({ phase: "init" });
  llm = await LlmInference.createFromOptions(genai, {
    baseOptions: { modelAssetPath: modelBlobUrl },
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
): Promise<ArrayBuffer> {
  const cache = await caches.open("chess-sensei-model").catch(() => null);
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      onProgress({ phase: "download", loaded: 1, total: 1 });
      return hit.arrayBuffer();
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
  const blob = new Blob(chunks as BlobPart[]);
  if (cache) {
    await cache.put(url, new Response(blob)).catch(() => {});
  }
  return blob.arrayBuffer();
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
