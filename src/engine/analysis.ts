import { Chess } from "chess.js";
import type { PvLine, Score, SearchResult } from "./uci";

export type Color = "w" | "b";

/** 手の評価区分（cp ロスによる分類） */
export type Quality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export const QUALITY_LABEL: Record<Quality, string> = {
  best: "最善手",
  good: "good（悪くない手）",
  inaccuracy: "不正確",
  mistake: "疑問手",
  blunder: "大悪手",
};

/** 詰みをセンチポーンに写像する（比較のため。手数が短いほど大きい） */
const MATE_CP = 30_000;

export function scoreToCp(score: Score): number {
  if (score.type === "cp") return score.value;
  const sign = score.value >= 0 ? 1 : -1;
  return sign * (MATE_CP - Math.min(Math.abs(score.value), 99) * 100);
}

/** エンジンの評価値は手番側視点。白視点に統一する */
export function toWhitePov(score: Score, turn: Color): Score {
  return turn === "w" ? score : { type: score.type, value: -score.value };
}

/** 白視点の評価値を「+1.25」「M3」のように整形する */
export function formatScore(score: Score): string {
  if (score.type === "mate") {
    const n = Math.abs(score.value);
    return `${score.value >= 0 ? "白" : "黒"}が ${n} 手で詰み`;
  }
  const pawns = score.value / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

/** 白視点の評価値を日本語の形勢表現にする */
export function describeAdvantage(score: Score): string {
  if (score.type === "mate") return score.value >= 0 ? "白の勝ち筋" : "黒の勝ち筋";
  const cp = score.value;
  const side = cp >= 0 ? "白" : "黒";
  const abs = Math.abs(cp);
  if (abs < 30) return "互角";
  if (abs < 90) return `${side}がやや有利`;
  if (abs < 250) return `${side}が有利`;
  if (abs < 600) return `${side}が優勢`;
  return `${side}が勝勢`;
}

/** 評価バー用に -1（黒勝勢）〜 +1（白勝勢）へ正規化する */
export function scoreToBar(score: Score): number {
  if (score.type === "mate") return score.value >= 0 ? 1 : -1;
  // ロジスティック曲線（1 ポーン差でおよそ 0.3）
  return 2 / (1 + Math.exp(-score.value / 350)) - 1;
}

/** UCI 表記の読み筋を SAN に変換する（変換できたところまで返す） */
export function pvToSan(fen: string, pv: string[], maxPlies = 6): string[] {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, maxPlies)) {
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4],
      });
      out.push(move.san);
    } catch {
      break;
    }
  }
  return out;
}

/** UCI 表記の 1 手を SAN に変換する */
export function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  return pvToSan(fen, [uci], 1)[0] ?? null;
}

/** 候補手（MultiPV）を SAN 付きで取り出す */
export type Candidate = { san: string; line: string[]; score: Score; scoreWhite: Score };

export function candidates(fen: string, result: SearchResult, limit = 3): Candidate[] {
  const turn = new Chess(fen).turn() as Color;
  return result.lines.slice(0, limit).flatMap((line: PvLine) => {
    const san = pvToSan(fen, line.pv, 6);
    if (san.length === 0) return [];
    return [{
      san: san[0],
      line: san,
      score: line.score,
      scoreWhite: toWhitePov(line.score, turn),
    }];
  });
}

/** 解析結果の代表評価値（白視点） */
export function mainScore(fen: string, result: SearchResult): Score {
  const turn = new Chess(fen).turn() as Color;
  const line = result.lines[0];
  if (!line) {
    const game = new Chess(fen);
    if (game.isCheckmate()) return { type: "mate", value: turn === "w" ? -1 : 1 };
    return { type: "cp", value: 0 };
  }
  return toWhitePov(line.score, turn);
}

export function classify(cpLoss: number, isBestMove: boolean): Quality {
  if (isBestMove || cpLoss <= 15) return "best";
  if (cpLoss <= 50) return "good";
  if (cpLoss <= 120) return "inaccuracy";
  if (cpLoss <= 300) return "mistake";
  return "blunder";
}

const PIECE_JA: Record<string, string> = {
  p: "ポーン", n: "ナイト", b: "ビショップ", r: "ルーク", q: "クイーン", k: "キング",
};

export function pieceName(letter: string | undefined): string | null {
  return letter ? PIECE_JA[letter.toLowerCase()] ?? null : null;
}

/** 1 手ぶんの講評データ。LLM にはこの事実だけを渡す */
export type MoveReview = {
  color: Color;
  /** 指された手（SAN） */
  san: string;
  moveNumber: number;
  quality: Quality;
  /** 最善手と比べて何センチポーン損したか */
  cpLoss: number;
  /** 手を指す前の評価値（白視点） */
  scoreBefore: Score;
  /** 手を指した後の評価値（白視点） */
  scoreAfter: Score;
  /** その局面での最善手（SAN） */
  bestSan: string | null;
  /** 最善手を選んだ場合の読み筋（SAN） */
  bestLine: string[];
  /** 指した手のあとに相手が狙っている手順（SAN） */
  replyLine: string[];
  /** 取った駒 */
  captured: string | null;
  gaveCheck: boolean;
  isCastle: boolean;
  promotion: string | null;
  /** 実際に相手（エンジン）が指した手 */
  opponentSan: string | null;
};

export type BuildReviewInput = {
  /** 手を指す前の局面 */
  fenBefore: string;
  /** 手を指す前の局面の解析結果 */
  before: SearchResult;
  /** 指された手（SAN） */
  san: string;
  /** 手を指した後の局面 */
  fenAfter: string;
  /** 手を指した後の局面の解析結果 */
  after: SearchResult;
  /** 実際に相手が指した手（SAN） */
  opponentSan?: string | null;
};

export function buildReview(input: BuildReviewInput): MoveReview {
  const { fenBefore, before, san, fenAfter, after } = input;
  const gameBefore = new Chess(fenBefore);
  const color = gameBefore.turn() as Color;
  const moveNumber = Number(fenBefore.split(" ")[5]) || 1;

  const detail = new Chess(fenBefore).move(san);
  const scoreBefore = mainScore(fenBefore, before);
  const scoreAfter = mainScore(fenAfter, after);

  const bestSan = uciToSan(fenBefore, before.bestMove);
  const isBest = bestSan !== null && bestSan === san;
  const signed = color === "w" ? 1 : -1;
  const cpLoss = Math.max(
    0,
    Math.round((scoreToCp(scoreBefore) - scoreToCp(scoreAfter)) * signed),
  );

  return {
    color,
    san,
    moveNumber,
    quality: classify(cpLoss, isBest),
    cpLoss,
    scoreBefore,
    scoreAfter,
    bestSan,
    bestLine: before.bestMove ? pvToSan(fenBefore, before.lines[0]?.pv ?? [before.bestMove], 5) : [],
    replyLine: pvToSan(fenAfter, after.lines[0]?.pv ?? [], 4),
    captured: pieceName(detail.captured),
    gaveCheck: detail.san.includes("+") || detail.san.includes("#"),
    isCastle: detail.san === "O-O" || detail.san === "O-O-O",
    promotion: pieceName(detail.promotion),
    opponentSan: input.opponentSan ?? null,
  };
}
