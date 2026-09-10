import { describeAdvantage, formatScore, scoreToBar } from "../engine/analysis";
import type { Score } from "../engine/uci";

type Props = { score: Score | null; analysing: boolean };

/** Stockfish の評価値バー（左=白有利 / 右=黒有利） */
export function EvalBar({ score, analysing }: Props) {
  const ratio = score ? (scoreToBar(score) + 1) / 2 : 0.5;
  return (
    <div className="evalbar">
      <div className="evalbar-track">
        <div className="evalbar-white" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="evalbar-text">
        {score ? `${formatScore(score)}（${describeAdvantage(score)}）` : "—"}
        {analysing && " 解析中…"}
      </span>
    </div>
  );
}
