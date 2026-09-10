import type { PlayOptions } from "./uci";

export type LevelId = "easy" | "normal" | "hard" | "max";

export type Level = PlayOptions & { id: LevelId; label: string };

/**
 * 対局相手の強さ。UCI_LimitStrength / UCI_Elo で制限する
 * （Stockfish の UCI_Elo は 1320〜3190）。
 */
export const LEVELS: Record<LevelId, Level> = {
  easy: { id: "easy", label: "やさしい (Elo 1350)", elo: 1350, movetime: 300 },
  normal: { id: "normal", label: "ふつう (Elo 1700)", elo: 1700, movetime: 500 },
  hard: { id: "hard", label: "つよい (Elo 2200)", elo: 2200, movetime: 800 },
  max: { id: "max", label: "本気（制限なし）", elo: null, movetime: 1500 },
};

export const LEVEL_IDS: LevelId[] = ["easy", "normal", "hard", "max"];

/** 講評・ヒント用の解析設定（対局の強さとは独立に常に最強で解析する） */
export const ANALYSIS = { depth: 14, movetime: 1200, multiPv: 3 };
