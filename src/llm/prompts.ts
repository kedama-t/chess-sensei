import {
  QUALITY_LABEL,
  describeAdvantage,
  formatScore,
  type Candidate,
  type MoveReview,
} from "../engine/analysis";
import type { Score } from "../engine/uci";

const SYSTEM =
  "あなたは初心者に教えるチェスのコーチ「Chess Sensei」です。" +
  "手の良し悪しの判断はすべて Stockfish の解析結果に従い、あなた自身は日本語での説明だけを担当します。";

const RULE = [
  "制約:",
  "- 解析結果に書かれていない手・評価・変化を書かない（新しい手を考え出さない）。",
  "- 手を挙げるときは解析結果にある SAN 表記をそのまま使う。",
  "- 数値の羅列ではなく、初心者に伝わる言葉で説明する。",
  "- 同じ内容を繰り返さない。",
].join("\n");

/** 講評の材料（LLM プロンプトにもテンプレート出力にも使う） */
export function reviewFacts(r: MoveReview): string {
  const lines = [
    `あなた（${r.color === "w" ? "白" : "黒"}番）の指し手: ${r.san}`,
    `Stockfish の判定: ${QUALITY_LABEL[r.quality]}（最善手との差 ${r.cpLoss} センチポーン）`,
    `評価値の変化（白視点）: ${formatScore(r.scoreBefore)} → ${formatScore(r.scoreAfter)}（${describeAdvantage(r.scoreAfter)}）`,
  ];
  if (r.bestSan) lines.push(`その局面での最善手: ${r.bestSan}`);
  if (r.bestLine.length > 1) lines.push(`最善手の読み筋: ${r.bestLine.join(" ")}`);
  if (r.captured) lines.push(`この手で取った駒: ${r.captured}`);
  if (r.gaveCheck) lines.push("この手はチェックをかけている");
  if (r.isCastle) lines.push("この手はキャスリング");
  if (r.promotion) lines.push(`この手はプロモーション（${r.promotion}に成る）`);
  if (r.opponentSan) lines.push(`相手が実際に指した手: ${r.opponentSan}`);
  // 最善手を指した場合は bestLine と同じ内容になるので省く
  if (r.replyLine.length > 0 && r.san !== r.bestSan) {
    lines.push(`この手のあと最善で進んだ場合の想定手順: ${r.replyLine.join(" ")}`);
  }
  return lines.join("\n");
}

/** 指した手の講評を書かせるプロンプト */
export function reviewPrompt(r: MoveReview): string {
  const focus =
    r.quality === "best" || r.quality === "good"
      ? "なぜこの手が良いのかを、狙いが分かるように説明してください。"
      : "何が問題で、代わりに最善手がなぜ良いのかを、優しく説明してください。";
  return `${SYSTEM}

Stockfish の解析結果:
${reviewFacts(r)}

${RULE}

${focus}
日本語で2〜3文。前置きや挨拶は不要です。`;
}

/** ヒントの材料 */
export type HintFacts = {
  score: Score;
  candidates: Candidate[];
  inCheck: boolean;
};

export function hintFacts(h: HintFacts): string {
  const lines = [
    `現在の評価値（白視点）: ${formatScore(h.score)}（${describeAdvantage(h.score)}）`,
    h.inCheck ? "あなたはチェックをかけられている" : null,
    "Stockfish の推奨手（上から順に良い手）:",
    ...h.candidates.map(
      (c, i) => `${i + 1}. ${c.san}（評価 ${formatScore(c.scoreWhite)}、読み筋: ${c.line.join(" ")}）`,
    ),
  ];
  return lines.filter(Boolean).join("\n");
}

/** ヒント解説を書かせるプロンプト */
export function hintPrompt(h: HintFacts): string {
  return `${SYSTEM}

生徒（白番）がこの局面でヒントを求めています。

Stockfish の解析結果:
${hintFacts(h)}

${RULE}

1番目の推奨手がなぜ良いのか（狙い）を中心に、日本語で2〜3文で説明してください。
必要なら2番目の手にも一言触れてかまいません。前置きや挨拶は不要です。`;
}
