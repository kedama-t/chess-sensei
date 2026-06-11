import { useCallback, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import { useChessGame, type GameStatus } from "./game/useChessGame";
import { pickAiMove, adviseOnMove, explainPosition } from "./llm/coach";
import { ModelLoader } from "./components/ModelLoader";

type Tab = "coach" | "thinking" | "moves";

const STATUS_LABEL: Record<GameStatus, string> = {
  playing: "",
  check: "チェック！",
  checkmate: "チェックメイト",
  stalemate: "ステイルメイト（引き分け）",
  draw: "引き分け",
};

export default function App() {
  const [ready, setReady] = useState(false);
  const g = useChessGame();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("coach");
  const [coachText, setCoachText] = useState(
    "こんにちは！白番はあなたです。駒を動かして対局を始めましょう。",
  );
  const [thinking, setThinking] = useState("");
  const [autoAdvice, setAutoAdvice] = useState(true);
  const adviceSeq = useRef(0);

  // ユーザーの着手後: AI の応手 → （任意で）アドバイス生成
  const afterUserMove = useCallback(
    async (userSan: string) => {
      setBusy(true);
      const seq = ++adviceSeq.current;
      const snapshot = new Chess(g.game.fen());
      try {
        if (!g.game.isGameOver()) {
          setTab("coach");
          setThinking("");
          const ai = await pickAiMove(g.game, setThinking);
          if (seq !== adviceSeq.current) return;
          g.move(ai.san);
          setCoachText(
            `私は ${ai.san} と指しました。${ai.fallback ? "（思考の整理に失敗したため、直感で選びました）" : "思考過程は「思考」タブからどうぞ。"}`,
          );
        }
        if (autoAdvice && seq === adviceSeq.current) {
          await adviseOnMove(snapshot, userSan, (t) => {
            if (seq === adviceSeq.current)
              setCoachText(`【${userSan} へのアドバイス】\n${t}`);
          });
        }
      } catch (e) {
        setCoachText(`エラーが発生しました: ${e instanceof Error ? e.message : e}`);
      } finally {
        if (seq === adviceSeq.current) setBusy(false);
      }
    },
    [g, autoAdvice],
  );

  const onDrop = useCallback(
    (from: string, to: string): boolean => {
      if (busy || g.turn !== "w" || g.game.isGameOver()) return false;
      const san = g.move({ from, to, promotion: "q" });
      if (!san) return false;
      void afterUserMove(san);
      return true;
    },
    [busy, g, afterUserMove],
  );

  // 無制限の「まった」: AI の応手と自分の手をまとめて戻す
  const takeBack = useCallback(() => {
    adviceSeq.current++;
    setBusy(false);
    const plies = g.turn === "w" ? 2 : 1;
    g.undo(plies);
    setCoachText("一手戻しました。じっくり考え直しましょう。");
  }, [g]);

  const askHint = useCallback(async () => {
    if (busy || g.game.isGameOver()) return;
    setBusy(true);
    setTab("coach");
    setCoachText("局面を分析しています…");
    try {
      await explainPosition(g.game, (t) => setCoachText(`【ヒント】\n${t}`));
    } catch (e) {
      setCoachText(`エラー: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }, [busy, g]);

  const reset = useCallback(() => {
    adviceSeq.current++;
    setBusy(false);
    g.reset();
    setThinking("");
    setCoachText("新しい対局です。よろしくお願いします！");
  }, [g]);

  if (!ready) return <ModelLoader onReady={() => setReady(true)} />;

  const statusText = STATUS_LABEL[g.status];

  return (
    <div className="app">
      <header>
        <h1>♞ Chess Sensei</h1>
        {statusText && <span className="status">{statusText}</span>}
      </header>

      <div className="layout">
        <div className="board-area">
          <Chessboard
            position={g.fen}
            onPieceDrop={onDrop}
            arePiecesDraggable={!busy && g.turn === "w"}
            customBoardStyle={{ borderRadius: "8px" }}
            customDarkSquareStyle={{ backgroundColor: "#7c93b2" }}
            customLightSquareStyle={{ backgroundColor: "#e8edf4" }}
          />
          <div className="controls">
            <button onClick={takeBack} disabled={g.history.length === 0}>
              ↩ まった
            </button>
            <button onClick={askHint} disabled={busy || g.game.isGameOver()}>
              💡 ヒント
            </button>
            <button onClick={reset}>🔄 新規対局</button>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoAdvice}
                onChange={(e) => setAutoAdvice(e.target.checked)}
              />
              自動アドバイス
            </label>
          </div>
        </div>

        <div className="panel">
          <nav className="tabs">
            <button className={tab === "coach" ? "active" : ""} onClick={() => setTab("coach")}>
              コーチ
            </button>
            <button className={tab === "thinking" ? "active" : ""} onClick={() => setTab("thinking")}>
              思考{busy && "…"}
            </button>
            <button className={tab === "moves" ? "active" : ""} onClick={() => setTab("moves")}>
              棋譜
            </button>
          </nav>
          <div className="panel-body">
            {tab === "coach" && <p className="coach-text">{coachText}</p>}
            {tab === "thinking" && (
              <p className="coach-text">
                {thinking || "AI が考えると、ここに思考過程が表示されます。"}
              </p>
            )}
            {tab === "moves" && (
              <ol className="moves">
                {chunk(g.history).map(([w, b], i) => (
                  <li key={i}>
                    <span>{w}</span> <span>{b ?? ""}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function chunk(moves: string[]): [string, string?][] {
  const out: [string, string?][] = [];
  for (let i = 0; i < moves.length; i += 2) out.push([moves[i], moves[i + 1]]);
  return out;
}
