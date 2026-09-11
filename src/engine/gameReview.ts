import { Chess } from "chess.js";
import { buildReview, type Color, type MoveReview, type Quality } from "./analysis";
import { GAME_REVIEW } from "./levels";
import { engine, type SearchResult } from "./uci";

export type ReviewProgress = { done: number; total: number };

export type SideSummary = {
  moves: number;
  /** 平均精度(%) */
  accuracy: number;
  /** 平均損失（センチポーン / ACPL） */
  acpl: number;
  counts: Record<Quality, number>;
};

export type GameReview = {
  /** 本譜の手順どおりの講評 */
  moves: MoveReview[];
  /** 各局面の FEN。fens[i] は moves[i] を指す前の局面、末尾は最終局面 */
  fens: string[];
  white: SideSummary;
  black: SideSummary;
  /** 中断して途中までしか解析できなかった場合 true */
  partial: boolean;
};

export type ReviewOptions = {
  onProgress?: (p: ReviewProgress) => void;
  /** true を返すと解析を打ち切って、そこまでの結果を返す */
  shouldStop?: () => boolean;
};

/** mate 絡みの評価差で平均が壊れないように 1 手の損失を上限つきで扱う */
const MAX_LOSS = 1000;

function summarize(moves: MoveReview[], color: Color): SideSummary {
  const own = moves.filter((m) => m.color === color);
  const counts: Record<Quality, number> = {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const m of own) counts[m.quality]++;
  if (own.length === 0) return { moves: 0, accuracy: 0, acpl: 0, counts };
  const acpl = own.reduce((sum, m) => sum + Math.min(m.cpLoss, MAX_LOSS), 0) / own.length;
  const accuracy = own.reduce((sum, m) => sum + m.accuracy, 0) / own.length;
  return {
    moves: own.length,
    accuracy: Math.round(accuracy * 10) / 10,
    acpl: Math.round(acpl),
    counts,
  };
}

/**
 * 棋譜全体を Stockfish で解析して、1 手ずつの講評と精度サマリーを作る。
 *
 * 局面 i の解析結果は「手 i を指す前の評価」と「手 i-1 を指した後の評価」を
 * 兼ねるので、N 手の棋譜でも解析は N+1 局面ぶんで済む。
 */
export async function reviewGame(
  history: string[],
  opts: ReviewOptions = {},
): Promise<GameReview> {
  const { onProgress, shouldStop } = opts;

  const game = new Chess();
  const fens = [game.fen()];
  for (const san of history) {
    game.move(san);
    fens.push(game.fen());
  }

  const total = fens.length;
  const results: SearchResult[] = [];
  let partial = false;
  for (let i = 0; i < total; i++) {
    if (shouldStop?.()) {
      partial = true;
      break;
    }
    results.push(await engine.analyse(fens[i], GAME_REVIEW));
    onProgress?.({ done: i + 1, total });
  }

  const moves: MoveReview[] = [];
  for (let i = 0; i + 1 < results.length; i++) {
    moves.push(
      buildReview({
        fenBefore: fens[i],
        before: results[i],
        san: history[i],
        fenAfter: fens[i + 1],
        after: results[i + 1],
        // 本譜で実際に指された次の手が「相手の応手」
        opponentSan: history[i + 1] ?? null,
      }),
    );
  }

  return {
    moves,
    fens,
    white: summarize(moves, "w"),
    black: summarize(moves, "b"),
    partial,
  };
}

/** 「12. Nf3」のような表示用ラベル */
export function moveLabel(move: MoveReview): string {
  return `${move.moveNumber}.${move.color === "w" ? "" : ".."} ${move.san}`;
}
