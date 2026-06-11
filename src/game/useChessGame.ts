import { useCallback, useRef, useState } from "react";
import { Chess } from "chess.js";

export type GameStatus =
  | "playing"
  | "checkmate"
  | "stalemate"
  | "draw"
  | "check";

function statusOf(game: Chess): GameStatus {
  if (game.isCheckmate()) return "checkmate";
  if (game.isStalemate()) return "stalemate";
  if (game.isDraw()) return "draw";
  if (game.isCheck()) return "check";
  return "playing";
}

/** chess.js を React state として扱うフック（無制限アンドゥ対応） */
export function useChessGame() {
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(gameRef.current.fen());
  const [history, setHistory] = useState<string[]>([]);

  const sync = useCallback(() => {
    setFen(gameRef.current.fen());
    setHistory(gameRef.current.history());
  }, []);

  /** SAN または from/to で指す。成功時は SAN を返す */
  const move = useCallback(
    (m: string | { from: string; to: string; promotion?: string }) => {
      try {
        const result = gameRef.current.move(m);
        sync();
        return result.san;
      } catch {
        return null;
      }
    },
    [sync],
  );

  /** 指定プライ数だけ戻す（まった） */
  const undo = useCallback(
    (plies: number) => {
      for (let i = 0; i < plies; i++) gameRef.current.undo();
      sync();
    },
    [sync],
  );

  const reset = useCallback(() => {
    gameRef.current = new Chess();
    sync();
  }, [sync]);

  return {
    game: gameRef.current,
    fen,
    history,
    status: statusOf(gameRef.current),
    turn: gameRef.current.turn(),
    move,
    undo,
    reset,
  };
}
