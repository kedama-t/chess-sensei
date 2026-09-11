import {
  QUALITY_LABEL,
  describeAdvantage,
  formatScore,
  type MoveReview,
} from "../engine/analysis";
import { generate, isReady, type Sampling } from "./runtime";
import { hintPrompt, reviewPrompt, type HintFacts } from "./prompts";

// 解説はハルシネーション抑制のため低め
const SAMPLING: Sampling = { temperature: 0.25, topK: 15 };

/**
 * LLM は「解説」だけを担当する。手の選択・評価はすべて Stockfish の結果で、
 * LLM が未ロード／失敗した場合はテンプレート文にフォールバックする。
 */
async function explain(
  prompt: string,
  fallback: string,
  onToken?: (text: string) => void,
): Promise<string> {
  if (!isReady()) return fallback;
  try {
    const text = await generate(prompt, { onToken, sampling: SAMPLING });
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

/** 指した手の講評 */
export function explainReview(
  review: MoveReview,
  onToken?: (text: string) => void,
): Promise<string> {
  return explain(reviewPrompt(review), fallbackReview(review), onToken);
}

/** ヒント（推奨手の解説） */
export function explainHint(
  facts: HintFacts,
  onToken?: (text: string) => void,
): Promise<string> {
  return explain(hintPrompt(facts), fallbackHint(facts), onToken);
}

/** LLM なしでも成立する講評テンプレート */
export function fallbackReview(r: MoveReview): string {
  const head = `${r.san} — ${QUALITY_LABEL[r.quality]}`;
  const evalText = `評価値は ${formatScore(r.scoreBefore)} → ${formatScore(r.scoreAfter)}（${describeAdvantage(r.scoreAfter)}）。`;
  const parts = [head, evalText];
  if (r.quality === "best") {
    if (r.bestLine.length > 1) parts.push(`想定手順: ${r.bestLine.join(" ")}`);
  } else if (r.bestSan) {
    parts.push(`最善手は ${r.bestSan}（${r.cpLoss} センチポーンの差）。`);
    if (r.bestLine.length > 1) parts.push(`その読み筋: ${r.bestLine.join(" ")}`);
  }
  if (r.opponentSan) parts.push(`相手の応手: ${r.opponentSan}`);
  if (r.replyLine.length > 0 && r.san !== r.bestSan) {
    parts.push(`このあとの想定手順: ${r.replyLine.join(" ")}`);
  }
  return parts.join("\n");
}

/** LLM なしでも成立するヒントテンプレート */
export function fallbackHint(h: HintFacts): string {
  const lines = [`形勢: ${formatScore(h.score)}（${describeAdvantage(h.score)}）`];
  if (h.inCheck) lines.push("チェックがかかっています。まずこれを解消しましょう。");
  lines.push("Stockfish の推奨手:");
  for (const [i, c] of h.candidates.entries()) {
    lines.push(`${i + 1}. ${c.san} — 評価 ${formatScore(c.scoreWhite)}／読み筋 ${c.line.join(" ")}`);
  }
  return lines.join("\n");
}
