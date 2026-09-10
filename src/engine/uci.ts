/**
 * Stockfish 18（wasm・シングルスレッド版）を Web Worker で動かす UCI ラッパー。
 *
 * シングルスレッド版を使うのは、GitHub Pages のような静的ホスティングでは
 * COOP/COEP ヘッダを付けられず SharedArrayBuffer（=マルチスレッド版の前提）が
 * 使えないため。エンジン本体は約 7MB で、初回のみダウンロードされる。
 */

const ENGINE_JS = "engine/stockfish-18-lite-single.js";
const ENGINE_WASM = "engine/stockfish-18-lite-single.wasm";

/** 評価値。cp = センチポーン、mate = N 手詰め */
export type Score = { type: "cp" | "mate"; value: number };

/** 読み筋 1 本ぶんの解析結果 */
export type PvLine = {
  multipv: number;
  depth: number;
  /** 手番側から見た評価値（白視点への変換は analysis.ts で行う） */
  score: Score;
  /** UCI 表記の読み筋 */
  pv: string[];
};

export type SearchResult = {
  /** UCI 表記の最善手。詰み・ステイルメイトでは null */
  bestMove: string | null;
  depth: number;
  lines: PvLine[];
};

export type AnalyseOptions = {
  depth?: number;
  movetime?: number;
  multiPv?: number;
};

export type PlayOptions = {
  movetime: number;
  depth?: number;
  /** UCI_Elo による強さ制限。null なら制限なし（最強） */
  elo?: number | null;
};

type LineHandler = (line: string) => void;

function engineUrl(): string {
  const base = import.meta.env.BASE_URL;
  const js = new URL(base + ENGINE_JS, location.href).href;
  const wasm = new URL(base + ENGINE_WASM, location.href).href;
  // stockfish.js は location.hash から wasm の URL を読む
  return `${js}#${encodeURIComponent(wasm)}`;
}

/** "info depth 12 multipv 1 score cp 34 pv e2e4 e7e5" 形式の行を解析する */
export function parseInfo(line: string): PvLine | null {
  if (!line.startsWith("info ")) return null;
  // 探索途中の暫定値（upperbound/lowerbound）は評価がぶれるので捨てる
  if (line.includes("upperbound") || line.includes("lowerbound")) return null;
  const pvIndex = line.indexOf(" pv ");
  if (pvIndex < 0) return null;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1]);
  if (!depth) return null;
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  if (!scoreMatch) return null;
  return {
    multipv: Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1),
    depth,
    score: { type: scoreMatch[1] as Score["type"], value: Number(scoreMatch[2]) },
    pv: line.slice(pvIndex + 4).trim().split(/\s+/),
  };
}

export class StockfishEngine {
  private worker: Worker | null = null;
  private handlers = new Set<LineHandler>();
  /** 探索を直列化するためのキュー（UCI は一度に 1 探索しか扱えない） */
  private queue: Promise<unknown> = Promise.resolve();
  private booting: Promise<void> | null = null;
  private multiPv = 1;
  private elo: number | null = null;

  /** ワーカーを起動し、uci ハンドシェイクを済ませる */
  boot(): Promise<void> {
    if (!this.booting) this.booting = this.doBoot().catch((e) => {
      this.booting = null;
      throw e;
    });
    return this.booting;
  }

  private async doBoot(): Promise<void> {
    const worker = new Worker(engineUrl());
    worker.onmessage = (e: MessageEvent) => {
      const text = typeof e.data === "string" ? e.data : String(e.data?.text ?? "");
      for (const h of [...this.handlers]) h(text);
    };
    this.worker = worker;
    const ok = this.await((l) => l.trim() === "uciok", 120_000);
    worker.postMessage("uci");
    await ok;
    await this.ready();
  }

  /** 条件に合う出力行が来るまで待つ */
  private await(match: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const handler: LineHandler = (line) => {
        if (!match(line)) return;
        clearTimeout(timer);
        this.handlers.delete(handler);
        resolve(line);
      };
      const timer = setTimeout(() => {
        this.handlers.delete(handler);
        reject(new Error("Stockfish が応答しませんでした"));
      }, timeoutMs);
      this.handlers.add(handler);
    });
  }

  private post(...commands: string[]): void {
    if (!this.worker) throw new Error("エンジンが起動していません");
    for (const c of commands) this.worker.postMessage(c);
  }

  private async ready(timeoutMs = 120_000): Promise<void> {
    const done = this.await((l) => l.trim() === "readyok", timeoutMs);
    this.post("isready");
    await done;
  }

  /** 探索を直列に実行する */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async setMultiPv(value: number): Promise<void> {
    if (this.multiPv === value) return;
    this.post(`setoption name MultiPV value ${value}`);
    this.multiPv = value;
    await this.ready();
  }

  private async setElo(elo: number | null): Promise<void> {
    if (this.elo === elo) return;
    if (elo === null) this.post("setoption name UCI_LimitStrength value false");
    else this.post("setoption name UCI_LimitStrength value true", `setoption name UCI_Elo value ${elo}`);
    this.elo = elo;
    await this.ready();
  }

  /** go コマンドを送り、bestmove まで待って読み筋を集める */
  private async search(fen: string, go: string, timeoutMs: number): Promise<SearchResult> {
    const lines = new Map<number, PvLine>();
    let depth = 0;
    const collect: LineHandler = (line) => {
      const info = parseInfo(line);
      if (!info) return;
      // 反復深化で深さが進んだら前の深さの読み筋は捨てる
      if (info.depth > depth) {
        depth = info.depth;
        lines.clear();
      }
      if (info.depth === depth) lines.set(info.multipv, info);
    };
    this.handlers.add(collect);
    try {
      const done = this.await((l) => l.startsWith("bestmove"), timeoutMs);
      this.post(`position fen ${fen}`, go);
      const best = (await done).split(/\s+/)[1];
      return {
        bestMove: best && best !== "(none)" ? best : null,
        depth,
        lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv),
      };
    } finally {
      this.handlers.delete(collect);
    }
  }

  /** 局面を解析する（強さ制限なし・複数候補手） */
  analyse(fen: string, opts: AnalyseOptions = {}): Promise<SearchResult> {
    const { depth = 14, movetime = 2000, multiPv = 1 } = opts;
    return this.run(async () => {
      await this.boot();
      await this.setElo(null);
      await this.setMultiPv(multiPv);
      return this.search(fen, `go depth ${depth} movetime ${movetime}`, movetime + 60_000);
    });
  }

  /** 指定の強さで指し手を選ぶ */
  play(fen: string, opts: PlayOptions): Promise<SearchResult> {
    const { movetime, depth, elo = null } = opts;
    return this.run(async () => {
      await this.boot();
      await this.setElo(elo);
      await this.setMultiPv(1);
      const go = depth ? `go depth ${depth} movetime ${movetime}` : `go movetime ${movetime}`;
      return this.search(fen, go, movetime + 60_000);
    });
  }

  /** 新しい対局を始める（置換表をクリア） */
  newGame(): Promise<void> {
    return this.run(async () => {
      await this.boot();
      this.post("ucinewgame");
      await this.ready();
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.booting = null;
    this.handlers.clear();
  }
}

/** アプリ全体で 1 つのエンジンを共有する */
export const engine = new StockfishEngine();
