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
  "あなたは経験豊富で親切なチェスのコーチ「Chess Sensei」です。初心者にも分かる日本語で簡潔に説明します。同じ語句や文を繰り返さず、要点だけを述べます。";

// 手に言及する解説で共通の制約（非合法手の捏造・冗長な繰り返しを防ぐ）
const MOVE_RULE =
  "手に言及するときは、必ず上記「合法手」リストにある SAN 表記の手だけを使うこと。リストにない手や存在しない駒・マスを書いてはいけない。";

/** AI の指し手を求めるプロンプト */
export function movePrompt(game: Chess): string {
  return `${SYSTEM}
あなたは黒番のプレイヤーとして次の一手を選びます。

${describePosition(game)}

${MOVE_RULE}
まず思考を1〜2文だけ書き、最後に必ず次の形式で1手だけ選んでください。
同じ内容を繰り返さず、簡潔に。指し手は「合法手」リストから正確に1つ選ぶこと。

思考: <1〜2文の思考過程>
指し手: <合法手リストにある SAN 表記の1手>`;
}

/** ユーザーの手へのワンポイントアドバイスを求めるプロンプト */
export function advicePrompt(game: Chess, userMove: string): string {
  return `${SYSTEM}
生徒（白番）が「${userMove}」と指しました。

${describePosition(game)}

${MOVE_RULE}
この手の良い点または注意点を、初心者向けに日本語で2文以内でアドバイスしてください。
良い手なら褒め、問題があれば理由と改善の方向性を優しく示すこと。具体的な手を挙げる場合も合法手リストの範囲に限ること。`;
}

/** ヒント（局面解説 + 良い手・悪手）を求めるプロンプト */
export function hintPrompt(game: Chess): string {
  return `${SYSTEM}
生徒（白番）がこの局面でヒントを求めています。

${describePosition(game)}

${MOVE_RULE}
次の構成で日本語で簡潔に解説してください（各項目1〜2文、繰り返さない）。
1. 局面の説明: 形勢や狙い
2. おすすめの手: 合法手リストから1〜2手、それぞれ理由を1文で
3. 避けたい手: 合法手リストから1手、理由を1文で`;
}
