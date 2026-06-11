import type { Chess } from "chess.js";

/** 盤面情報をプロンプト用テキストに整形 */
export function describePosition(game: Chess): string {
  const history = game.history();
  const recent = history.slice(-12).join(" ");
  return [
    `FEN: ${game.fen()}`,
    `手番: ${game.turn() === "w" ? "白" : "黒"}`,
    `直近の手: ${recent || "(開始局面)"}`,
    `合法手: ${game.moves().join(", ")}`,
  ].join("\n");
}

const SYSTEM =
  "あなたは経験豊富で親切なチェスのコーチ「Chess Sensei」です。初心者にも分かる日本語で簡潔に説明します。";

/** AI の指し手を求めるプロンプト */
export function movePrompt(game: Chess): string {
  return `${SYSTEM}
あなたは黒番のプレイヤーとして次の一手を選びます。

${describePosition(game)}

まず短く思考過程を書き、最後に必ず次の形式で1手だけ選んでください。
指し手は上記の「合法手」リストの中から正確に選ぶこと。

思考: <2〜3文の思考過程>
指し手: <SAN表記の合法手>`;
}

/** ユーザーの手へのワンポイントアドバイスを求めるプロンプト */
export function advicePrompt(game: Chess, userMove: string): string {
  return `${SYSTEM}
生徒（白番）が「${userMove}」と指しました。

${describePosition(game)}

この手の良い点や注意点を、初心者向けに日本語で2〜3文でアドバイスしてください。
良い手なら褒め、問題があれば理由と改善の方向性を優しく示してください。`;
}

/** ヒント（局面解説 + 良い手・悪手）を求めるプロンプト */
export function hintPrompt(game: Chess): string {
  return `${SYSTEM}
生徒（白番）がこの局面でヒントを求めています。

${describePosition(game)}

次の構成で日本語で解説してください。
1. 局面の説明: 形勢や狙いを2〜3文で
2. おすすめの手: 合法手リストから1〜2手を挙げ、それぞれ理由を1文で
3. 避けたい手: 合法手リストから悪手を1手挙げ、理由を1文で`;
}
