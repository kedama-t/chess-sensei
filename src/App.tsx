import { useCallback, useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import type { Square } from "chess.js";
import { useChessGame, type GameStatus } from "./game/useChessGame";
import { engine, type SearchResult, type Score } from "./engine/uci";
import { ANALYSIS, LEVELS, LEVEL_IDS, type LevelId } from "./engine/levels";
import {
  QUALITY_LABEL,
  buildReview,
  candidates,
  formatScore,
  mainScore,
  uciToSan,
  type MoveReview,
} from "./engine/analysis";
import { explainHint, explainReview, fallbackHint, fallbackReview } from "./llm/explain";
import { useLlm } from "./llm/useLlm";
import { EvalBar } from "./components/EvalBar";
import { LlmPanel } from "./components/LlmPanel";

type Tab = "coach" | "analysis" | "moves";

const STATUS_LABEL: Record<GameStatus, string> = {
  playing: "",
  check: "チェック！",
  checkmate: "チェックメイト",
  stalemate: "ステイルメイト（引き分け）",
  draw: "引き分け",
};

const GREETING = "白番はあなたです。駒を動かすと、Stockfish が応手と講評を返します。";

export default function App() {
  const g = useChessGame();
  const llm = useLlm();

  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelId>("normal");

  const [score, setScore] = useState<Score | null>(null);
  const [analysis, setAnalysis] = useState<SearchResult | null>(null);
  const [review, setReview] = useState<MoveReview | null>(null);

  const [tab, setTab] = useState<Tab>("coach");
  const [coachTitle, setCoachTitle] = useState("Chess Sensei");
  const [coachText, setCoachText] = useState(GREETING);
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [arrow, setArrow] = useState<[Square, Square] | null>(null);

  // 手を戻す・リセットしたときに、進行中の解析や解説の結果を捨てるための世代番号
  const seqRef = useRef(0);
  // 現局面の解析結果をキャッシュ（講評の「指す前の評価」として再利用する）
  const cacheRef = useRef<{ fen: string; promise: Promise<SearchResult> } | null>(null);

  const analyseFen = useCallback((fen: string): Promise<SearchResult> => {
    if (cacheRef.current?.fen !== fen) {
      cacheRef.current = { fen, promise: engine.analyse(fen, ANALYSIS) };
    }
    return cacheRef.current.promise;
  }, []);

  // エンジンの起動
  useEffect(() => {
    let alive = true;
    engine
      .boot()
      .then(() => alive && setEngineReady(true))
      .catch((e) => alive && setEngineError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // 自分の手番になったら現局面を解析して評価バーとヒントの材料を用意する
  useEffect(() => {
    if (!engineReady || busy || g.game.isGameOver()) return;
    const fen = g.fen;
    const seq = seqRef.current;
    let alive = true;
    void analyseFen(fen)
      .then((result) => {
        if (!alive || seq !== seqRef.current) return;
        setAnalysis(result);
        setScore(mainScore(fen, result));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [engineReady, busy, g.fen, g.game, analyseFen]);

  /** ユーザーの着手後: 講評用の解析 → エンジンの応手 → 解説 */
  const afterUserMove = useCallback(
    async (userSan: string, fenBefore: string) => {
      const seq = ++seqRef.current;
      const stale = () => seq !== seqRef.current;
      setBusy(true);
      setTab("coach");
      setArrow(null);
      setCoachTitle(`${userSan} の講評`);
      setCoachText("Stockfish が解析しています…");

      let result: MoveReview | null = null;
      try {
        const before = await analyseFen(fenBefore);
        if (stale()) return;

        const fenAfter = g.game.fen();
        const after = await engine.analyse(fenAfter, { ...ANALYSIS, multiPv: 1 });
        if (stale()) return;

        let opponentSan: string | null = null;
        if (!g.game.isGameOver()) {
          const played = await engine.play(fenAfter, LEVELS[level]);
          if (stale()) return;
          opponentSan = uciToSan(fenAfter, played.bestMove);
          if (opponentSan) g.move(opponentSan);
        }

        result = buildReview({ fenBefore, before, san: userSan, fenAfter, after, opponentSan });
        setReview(result);
        setCoachText(fallbackReview(result));
      } catch (e) {
        if (!stale()) setCoachText(`エラーが発生しました: ${e instanceof Error ? e.message : e}`);
      } finally {
        if (!stale()) setBusy(false);
      }

      // 解説 AI が有効なときだけ、同じ解析結果を文章にしてもらう
      if (!result || stale() || !llm.ready) return;
      setExplaining(true);
      try {
        const text = await explainReview(result, (t) => {
          if (!stale()) setCoachText(t);
        });
        if (!stale()) setCoachText(text);
      } finally {
        if (!stale()) setExplaining(false);
      }
    },
    [analyseFen, g, level, llm.ready],
  );

  const onDrop = useCallback(
    (from: string, to: string): boolean => {
      if (busy || !engineReady || g.turn !== "w" || g.game.isGameOver()) return false;
      const fenBefore = g.game.fen();
      const san = g.move({ from, to, promotion: "q" });
      if (!san) return false;
      void afterUserMove(san, fenBefore);
      return true;
    },
    [busy, engineReady, g, afterUserMove],
  );

  // 無制限の「まった」: エンジンの応手と自分の手をまとめて戻す
  const takeBack = useCallback(() => {
    seqRef.current++;
    setBusy(false);
    setExplaining(false);
    setArrow(null);
    setReview(null);
    g.undo(g.turn === "w" ? 2 : 1);
    setCoachTitle("まった");
    setCoachText("一手戻しました。じっくり考え直しましょう。");
  }, [g]);

  const askHint = useCallback(async () => {
    if (busy || !engineReady || g.game.isGameOver()) return;
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;
    const fen = g.fen;
    setTab("coach");
    setCoachTitle("ヒント");
    setCoachText("Stockfish が候補手を探しています…");
    try {
      const result = await analyseFen(fen);
      if (stale()) return;
      const facts = {
        score: mainScore(fen, result),
        candidates: candidates(fen, result, 3),
        inCheck: g.game.isCheck(),
      };
      setAnalysis(result);
      setScore(facts.score);
      setCoachText(fallbackHint(facts));
      if (result.bestMove) {
        setArrow([result.bestMove.slice(0, 2) as Square, result.bestMove.slice(2, 4) as Square]);
      }
      if (!llm.ready) return;
      setExplaining(true);
      try {
        const text = await explainHint(facts, (t) => {
          if (!stale()) setCoachText(t);
        });
        if (!stale()) setCoachText(text);
      } finally {
        if (!stale()) setExplaining(false);
      }
    } catch (e) {
      if (!stale()) setCoachText(`エラー: ${e instanceof Error ? e.message : e}`);
    }
  }, [busy, engineReady, g, analyseFen, llm.ready]);

  const reset = useCallback(() => {
    seqRef.current++;
    setBusy(false);
    setExplaining(false);
    setArrow(null);
    setReview(null);
    setScore(null);
    setAnalysis(null);
    cacheRef.current = null;
    g.reset();
    void engine.newGame().catch(() => undefined);
    setCoachTitle("Chess Sensei");
    setCoachText(`新しい対局です。${GREETING}`);
  }, [g]);

  const statusText = STATUS_LABEL[g.status];
  const canPlay = engineReady && !busy && g.turn === "w" && !g.game.isGameOver();

  return (
    <div className="app">
      <header>
        <h1>♞ Chess Sensei</h1>
        {statusText && <span className="status">{statusText}</span>}
        {review && <span className={`badge q-${review.quality}`}>{QUALITY_LABEL[review.quality]}</span>}
      </header>

      {engineError && <p className="error">Stockfish の起動に失敗しました: {engineError}</p>}

      <div className="layout">
        <div className="board-area">
          <EvalBar score={score} analysing={busy} />
          <Chessboard
            position={g.fen}
            onPieceDrop={onDrop}
            arePiecesDraggable={canPlay}
            customArrows={arrow ? [arrow] : []}
            customBoardStyle={{ borderRadius: "8px" }}
            customDarkSquareStyle={{ backgroundColor: "#7c93b2" }}
            customLightSquareStyle={{ backgroundColor: "#e8edf4" }}
          />
          <div className="controls">
            <button onClick={takeBack} disabled={busy || g.history.length === 0}>
              ↩ まった
            </button>
            <button onClick={() => void askHint()} disabled={!canPlay}>
              💡 ヒント
            </button>
            <button onClick={reset}>🔄 新規対局</button>
            <label className="toggle">
              相手の強さ
              <select value={level} onChange={(e) => setLevel(e.target.value as LevelId)}>
                {LEVEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {LEVELS[id].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="panel">
          <nav className="tabs">
            <button className={tab === "coach" ? "active" : ""} onClick={() => setTab("coach")}>
              コーチ{explaining && "…"}
            </button>
            <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}>
              解析{busy && "…"}
            </button>
            <button className={tab === "moves" ? "active" : ""} onClick={() => setTab("moves")}>
              棋譜
            </button>
          </nav>
          <div className="panel-body">
            {tab === "coach" && (
              <>
                <h2 className="coach-title">{coachTitle}</h2>
                <p className="coach-text">{coachText}</p>
                <LlmPanel
                  status={llm.status}
                  progress={llm.progress}
                  error={llm.error}
                  onEnable={llm.enable}
                  onDisable={llm.disable}
                />
              </>
            )}
            {tab === "analysis" && <AnalysisView fen={g.fen} analysis={analysis} busy={busy} />}
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

function AnalysisView({
  fen,
  analysis,
  busy,
}: {
  fen: string;
  analysis: SearchResult | null;
  busy: boolean;
}) {
  if (!analysis) {
    return <p className="coach-text">{busy ? "解析中…" : "Stockfish の解析結果がここに出ます。"}</p>;
  }
  const lines = candidates(fen, analysis, 3);
  return (
    <div className="analysis">
      <p className="muted">Stockfish 18 (lite) / 深さ {analysis.depth}</p>
      <ol className="lines">
        {lines.map((c, i) => (
          <li key={i}>
            <span className="lines-score">{formatScore(c.scoreWhite)}</span>
            <span className="lines-pv">{c.line.join(" ")}</span>
          </li>
        ))}
      </ol>
      {lines.length === 0 && <p className="coach-text">候補手がありません（対局終了）。</p>}
    </div>
  );
}

function chunk(moves: string[]): [string, string?][] {
  const out: [string, string?][] = [];
  for (let i = 0; i < moves.length; i += 2) out.push([moves[i], moves[i + 1]]);
  return out;
}
