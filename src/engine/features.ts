import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

/**
 * 盤面から「LLM が説明に使える具体的な事実」を取り出す。
 *
 * オンデバイスの小さい LLM は SAN と評価値だけでは理由を語れないので、
 * 当たり・ただ取り・展開・キング・中央支配といった手がかりを
 * chess.js で機械的に計算して渡す。判断は Stockfish、言語化が LLM の役割。
 */

const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const JA: Record<PieceSymbol, string> = {
  p: "ポーン",
  n: "ナイト",
  b: "ビショップ",
  r: "ルーク",
  q: "クイーン",
  k: "キング",
};

const CENTER: Square[] = ["d4", "e4", "d5", "e5"];
const HOME: Record<Color, Square[]> = {
  w: ["b1", "c1", "f1", "g1"],
  b: ["b8", "c8", "f8", "g8"],
};

export function pieceJa(piece: PieceSymbol): string {
  return JA[piece];
}

function other(color: Color): Color {
  return color === "w" ? "b" : "w";
}

/** 1 手を「Nxe5（ナイトで e5 のポーンを取る、チェック）」のように日本語化する */
export function describeMove(fen: string, san: string): string | null {
  const game = new Chess(fen);
  let move;
  try {
    move = game.move(san);
  } catch {
    return null;
  }
  if (move.san.startsWith("O-O")) {
    const side = move.san === "O-O" ? "キングサイド" : "クイーンサイド";
    return `${move.san}（${side}にキャスリング）`;
  }
  const parts = [
    move.captured
      ? `${JA[move.piece]}で ${move.to} の${JA[move.captured]}を取る`
      : `${JA[move.piece]}を ${move.to} へ`,
  ];
  if (move.promotion) parts.push(`${JA[move.promotion]}に成る`);
  if (game.isCheckmate()) parts.push("チェックメイト");
  else if (game.isCheck()) parts.push("チェック");
  return `${move.san}（${parts.join("、")}）`;
}

/** 読み筋の先頭数手を日本語つきで並べる */
export function describeLine(fen: string, line: string[], plies = 3): string {
  const game = new Chess(fen);
  const out: string[] = [];
  for (const san of line.slice(0, plies)) {
    const described = describeMove(game.fen(), san);
    if (!described) break;
    out.push(described);
    game.move(san);
  }
  return out.join(" → ");
}

export type LoosePiece = {
  square: Square;
  ja: string;
  value: number;
  defended: boolean;
  /** 狙っている一番安い駒 */
  attackedBy: string;
};

/**
 * color 側の駒のうち、ただ取りされる（または安い駒との交換で損をする）もの。
 * 取り合いの厳密な評価ではなく、攻め駒と守り駒の枚数・価値による近似。
 */
export function loosePieces(fen: string, color: Color): LoosePiece[] {
  const game = new Chess(fen);
  const found: LoosePiece[] = [];
  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== color || cell.type === "k") continue;
      const attackers = game.attackers(cell.square, other(color));
      if (attackers.length === 0) continue;
      const defenders = game.attackers(cell.square, color);
      const cheapest = attackers.reduce(
        (min, sq) => Math.min(min, VALUE[game.get(sq)!.type] || 10),
        99,
      );
      const value = VALUE[cell.type];
      if (defenders.length > 0 && cheapest >= value) continue;
      const cheapestPiece = attackers
        .map((sq) => game.get(sq)!.type)
        .sort((a, b) => VALUE[a] - VALUE[b])[0];
      found.push({
        square: cell.square,
        ja: JA[cell.type],
        value,
        defended: defenders.length > 0,
        attackedBy: JA[cheapestPiece],
      });
    }
  }
  return found.sort((a, b) => b.value - a.value).slice(0, 3);
}

/** loosePieces の結果を 1 行の日本語にする */
export function describeLoose(pieces: LoosePiece[]): string {
  return pieces
    .map(
      (p) =>
        `${p.square} の${p.ja}（${p.attackedBy}に狙われ、${p.defended ? "守りが足りない" : "守りなし"}）`,
    )
    .join("、");
}

export type AttackedPiece = { square: Square; ja: string; value: number };

/** その手で動かした駒が新たに当たりにしている相手の駒 */
export function attackedByMove(fen: string, san: string): AttackedPiece[] {
  const game = new Chess(fen);
  let move;
  try {
    move = game.move(san);
  } catch {
    return [];
  }
  const enemy = other(move.color);
  const targets: AttackedPiece[] = [];
  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.type === "k") continue;
      if (!game.attackers(cell.square, move.color).includes(move.to)) continue;
      const defended = game.attackers(cell.square, enemy).length > 0;
      // 価値のある駒か、ただ取りできる駒だけを挙げる
      if (VALUE[cell.type] >= 3 || !defended) {
        targets.push({ square: cell.square, ja: JA[cell.type], value: VALUE[cell.type] });
      }
    }
  }
  return targets.sort((a, b) => b.value - a.value).slice(0, 2);
}

/** ポーン換算のマテリアル（白 - 黒） */
export function materialDiff(fen: string): number {
  const game = new Chess(fen);
  let diff = 0;
  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell) continue;
      diff += (cell.color === "w" ? 1 : -1) * VALUE[cell.type];
    }
  }
  return diff;
}

/** 展開済みのマイナーピース数（初期マスにないナイト・ビショップ） */
function developed(game: Chess, color: Color): number {
  return HOME[color].filter((sq) => {
    const cell = game.get(sq);
    return !cell || cell.color !== color || (cell.type !== "n" && cell.type !== "b");
  }).length;
}

function kingInfo(game: Chess, color: Color): string {
  const square = game
    .board()
    .flat()
    .find((cell) => cell && cell.color === color && cell.type === "k")?.square;
  if (!square) return "不明";
  const rights = game.getCastlingRights(color);
  const castled = rights.k || rights.q ? "" : "（キャスリング権なし）";
  const home = color === "w" ? "e1" : "e8";
  const state = square === home ? "（未キャスリング）" : castled || "（動いている）";
  return `${square}${state}`;
}

/** d4/e4/d5/e5 をどちらが多く効かせているか（駒の効きの数） */
function centerControl(game: Chess, color: Color): number {
  return CENTER.reduce((sum, sq) => sum + game.attackers(sq, color).length, 0);
}

/** 中央マスに実際に置かれている駒 */
function centerPieces(game: Chess, color: Color): string {
  const pieces = CENTER.flatMap((sq) => {
    const cell = game.get(sq);
    return cell && cell.color === color ? [`${sq} の${JA[cell.type]}`] : [];
  });
  return pieces.length > 0 ? pieces.join("、") : "なし";
}

/** 局面のあらまし（LLM プロンプト用の数行） */
export function positionSummary(fen: string): string {
  const game = new Chess(fen);
  const diff = materialDiff(fen);
  const material =
    diff === 0 ? "互角" : `${diff > 0 ? "白" : "黒"}が ${Math.abs(diff)} ポーンぶん多い`;
  return [
    `駒の損得: ${material}`,
    `展開（ナイト・ビショップ）: 白 ${developed(game, "w")}/4、黒 ${developed(game, "b")}/4`,
    `キング: 白 ${kingInfo(game, "w")}、黒 ${kingInfo(game, "b")}`,
    `中央 d4/e4/d5/e5 の駒: 白 ${centerPieces(game, "w")}／黒 ${centerPieces(game, "b")}`,
    `中央への効き: 白 ${centerControl(game, "w")}、黒 ${centerControl(game, "b")}`,
  ].join("\n");
}
