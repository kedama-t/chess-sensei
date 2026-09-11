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
 * LLM は「解説」だけを担当する。手の選択・評価はすべて Stockfish の結果。
 * LLM が未ロード／生成失敗のときは null を返す（Stockfish の分析は
 * describeReview / describeHint で常に表示される）。
 */
async function explain(
  prompt: string,
  onToken?: (text: string) => void,
): Promise<string | null> {
  if (!isReady()) return null;
  try {
    const text = await generate(prompt, { onToken, sampling: SAMPLING });
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** 指した手の講評（AI 解説） */
export function explainReview(
  review: MoveReview,
  onToken?: (text: string) => void,
): Promise<string | null> {
  return explain(reviewPrompt(review), onToken);
}

/** ヒントの AI 解説 */
export function explainHint(
  facts: HintFacts,
  onToken?: (text: string) => void,
): Promise<string | null> {
  return explain(hintPrompt(facts), onToken);
}

/** Stockfish の解析結果そのものを日本語に整形した講評（常に表示する） */
export function describeReview(r: MoveReview): string {
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

/** Stockfish の解析結果そのものを整形したヒント（常に表示する） */
export function describeHint(h: HintFacts): string {
  const lines = [`形勢: ${formatScore(h.score)}（${describeAdvantage(h.score)}）`];
  if (h.inCheck) lines.push("チェックがかかっています。まずこれを解消しましょう。");
  lines.push("Stockfish の推奨手:");
  for (const [i, c] of h.candidates.entries()) {
    lines.push(`${i + 1}. ${c.san} — 評価 ${formatScore(c.scoreWhite)}／読み筋 ${c.line.join(" ")}`);
  }
  return lines.join("\n");
}
