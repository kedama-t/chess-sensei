import { Chess } from "chess.js";
import { generate, type Sampling } from "./engine";
import { movePrompt, advicePrompt, hintPrompt } from "./prompts";

// 指し手は合法手で検証するためループ回避優先、解説はハルシネーション抑制で低め
const MOVE_SAMPLING: Sampling = { temperature: 0.4, topK: 20 };
const ADVICE_SAMPLING: Sampling = { temperature: 0.25, topK: 15 };
const HINT_SAMPLING: Sampling = { temperature: 0.3, topK: 20 };

export type AiMoveResult = {
  san: string;
  thinking: string;
  fallback: boolean;
};

/** LLM に指し手を選ばせる。解析失敗時はヒューリスティックにフォールバック */
export async function pickAiMove(
  game: Chess,
  onToken?: (text: string) => void,
): Promise<AiMoveResult> {
  const legal = game.moves();
  const raw = await generate(movePrompt(game), {
    onToken,
    sampling: MOVE_SAMPLING,
  });

  const thinkMatch = raw.match(/思考[:：]\s*([\s\S]*?)(?=指し手[:：]|$)/);
  const moveMatch = raw.match(/指し手[:：]\s*([^\s。]+)/);
  const thinking = (thinkMatch?.[1] ?? raw).trim();

  const candidate = moveMatch?.[1]?.trim();
  if (candidate && legal.includes(candidate)) {
    return { san: candidate, thinking, fallback: false };
  }
  // 出力中に現れる合法手を拾う
  const found = legal.find((m) => raw.includes(m));
  if (found) return { san: found, thinking, fallback: false };

  return { san: heuristicMove(game), thinking, fallback: true };
}

/** チェック > 駒得 > ランダム の簡易ヒューリスティック */
function heuristicMove(game: Chess): string {
  const moves = game.moves({ verbose: true });
  const check = moves.find((m) => m.san.includes("+") || m.san.includes("#"));
  if (check) return check.san;
  const captures = moves.filter((m) => m.captured);
  if (captures.length > 0) {
    const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    captures.sort((a, b) => (value[b.captured!] ?? 0) - (value[a.captured!] ?? 0));
    return captures[0].san;
  }
  return moves[Math.floor(Math.random() * moves.length)].san;
}

/** ユーザーの手に対するアドバイスを生成 */
export function adviseOnMove(
  game: Chess,
  userMove: string,
  onToken?: (text: string) => void,
): Promise<string> {
  return generate(advicePrompt(game, userMove), {
    onToken,
    sampling: ADVICE_SAMPLING,
  });
}

/** 現局面のヒント解説を生成 */
export function explainPosition(
  game: Chess,
  onToken?: (text: string) => void,
): Promise<string> {
  return generate(hintPrompt(game), { onToken, sampling: HINT_SAMPLING });
}
