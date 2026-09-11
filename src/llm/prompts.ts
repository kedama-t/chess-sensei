import {
  QUALITY_LABEL,
  describeAdvantage,
  formatScore,
  type Candidate,
  type MoveReview,
} from "../engine/analysis";
import {
  attackedByMove,
  describeLine,
  describeLoose,
  describeMove,
  loosePieces,
  positionSummary,
} from "../engine/features";
import type { Score } from "../engine/uci";

const SYSTEM =
  "あなたは初心者に教えるチェスのコーチ「Chess Sensei」です。" +
  "手の良し悪しの判断はすべて Stockfish の解析結果に従い、あなたは" +
  "「なぜそうなるのか」を局面の事実にもとづいて日本語で説明します。";

const RULE = [
  "守ること:",
  "- 以下に書かれた事実（評価値・読み筋・駒の当たり・展開・キングの位置）だけを根拠にする。",
  "- 書かれていない手や変化を新しく考え出さない。手を挙げるときは SAN 表記をそのまま使う。",
  "- 「Stockfish によると」ではなく、どの駒がどうなるからそう言えるのかを書く。",
  "- 評価値の数値を並べるだけにしない。初心者に伝わる言葉にする。",
  "- 同じ内容を繰り返さない。",
].join("\n");

function line(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

/** 講評の材料。Stockfish の解析結果 + 盤面から機械的に取り出した事実 */
export function reviewFacts(r: MoveReview): string {
  const opponent = r.color === "w" ? "b" : "w";
  const played = describeMove(r.fenBefore, r.san) ?? r.san;
  const best = r.bestSan ? describeMove(r.fenBefore, r.bestSan) : null;
  const attacks = attackedByMove(r.fenBefore, r.san);
  const myLoose = loosePieces(r.fenAfter, r.color);
  const theirLoose = loosePieces(r.fenAfter, opponent);

  return [
    `【手を指す前の局面】`,
    positionSummary(r.fenBefore),
    ``,
    `【あなたが指した手】`,
    `${played}`,
    `Stockfish の判定: ${QUALITY_LABEL[r.quality]}（最善手との差 ${r.cpLoss} センチポーン）`,
    `評価値の変化（白視点）: ${formatScore(r.scoreBefore)} → ${formatScore(r.scoreAfter)}（${describeAdvantage(r.scoreAfter)}）`,
    line("この手で当たりにした相手の駒", attacks.map((a) => `${a.square} の${a.ja}`).join("、")),
    line("この手のあと相手にただで取られそうな自分の駒", describeLoose(myLoose)),
    line("この手のあと狙える相手の弱い駒", describeLoose(theirLoose)),
    line("この手のあとの想定手順", describeLine(r.fenAfter, r.replyLine, 3)),
    line("実際の相手の応手", r.opponentSan ? describeMove(r.fenAfter, r.opponentSan) : null),
    ``,
    // 指した手が最善手そのものの場合、読み筋は「この手のあとの想定手順」と同じなので繰り返さない
    r.san === r.bestSan ? "この手が Stockfish の最善手です。" : "【Stockfish の最善手】",
    r.san === r.bestSan ? null : best,
    r.san === r.bestSan ? null : line("最善手の読み筋", describeLine(r.fenBefore, r.bestLine, 3)),
  ]
    .filter((v) => v !== null)
    .join("\n");
}

/** 指した手の講評を書かせるプロンプト */
export function reviewPrompt(r: MoveReview): string {
  const good = r.quality === "best" || r.quality === "good";
  const focus = good
    ? [
        "1. この手がどんな狙いを持っているか（どの駒がどこに効くようになったか）",
        "2. そのあと何を目指すとよいか",
      ]
    : [
        "1. この手が何を見落としているか（どの駒が取られる・どこが弱くなる）",
        "2. 最善手ならどうなるか、なぜそちらが良いのか",
      ];

  return `${SYSTEM}

${reviewFacts(r)}

${RULE}

次の順で、日本語で3〜4文で説明してください。前置きや挨拶、箇条書きの見出しは不要です。
${focus.join("\n")}`;
}

/** ヒントの材料 */
export type HintFacts = {
  fen: string;
  score: Score;
  candidates: Candidate[];
  inCheck: boolean;
};

export function hintFacts(h: HintFacts): string {
  const myLoose = loosePieces(h.fen, "w");
  const theirLoose = loosePieces(h.fen, "b");
  return [
    `【いまの局面】`,
    positionSummary(h.fen),
    `評価値（白視点）: ${formatScore(h.score)}（${describeAdvantage(h.score)}）`,
    h.inCheck ? "あなたはチェックをかけられている" : null,
    line("取られそうな自分の駒", describeLoose(myLoose)),
    line("狙える相手の弱い駒", describeLoose(theirLoose)),
    ``,
    `【Stockfish の推奨手（上から順に良い）】`,
    ...h.candidates.map((c, i) => {
      const described = describeMove(h.fen, c.san) ?? c.san;
      return `${i + 1}. ${described} — 評価 ${formatScore(c.scoreWhite)}／読み筋 ${describeLine(h.fen, c.line, 3)}`;
    }),
  ]
    .filter((v) => v !== null)
    .join("\n");
}

/** ヒント解説を書かせるプロンプト */
export function hintPrompt(h: HintFacts): string {
  return `${SYSTEM}

生徒（白番）がこの局面でヒントを求めています。

${hintFacts(h)}

${RULE}

次の順で、日本語で3〜4文で説明してください。前置きや挨拶は不要です。
1. いまの局面で何が起きているか（駒の当たり、キングの安全、中央や展開のうち大事なもの）
2. 1番目の推奨手がなぜ良いのか（その手で何が変わるか）
3. 逆に気をつけること（取られそうな駒があればそれ）`;
}
