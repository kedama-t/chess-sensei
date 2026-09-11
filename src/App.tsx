import { useCallback, useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { useChessGame, type GameStatus } from "./game/useChessGame";
import { engine, type SearchResult, type Score } from "./engine/uci";
import { ANALYSIS, LEVELS, LEVEL_IDS, type LevelId } from "./engine/levels";
import {
  QUALITY_LABEL,
  buildReview,
  candidates,
  formatScore,
  mainScore,
  sanToSquares,
  uciToSan,
  type MoveReview,
} from "./engine/analysis";
import {
  moveLabel,
  reviewGame,
  type GameReview,
  type ReviewProgress,
} from "./engine/gameReview";
import { describeHint, describeReview, explainHint, explainReview } from "./llm/explain";
import { useLlm } from "./llm/useLlm";
import { EvalBar } from "./components/EvalBar";
import { LlmPanel } from "./components/LlmPanel";
import { ReviewPanel } from "./components/ReviewPanel";

type Tab = "coach" | "analysis" | "moves" | "review";

const STATUS_LABEL: Record<GameStatus, string> = {
  playing: "",
  check: "チェック！",
  checkmate: "チェックメイト",
  stalemate: "ステイルメイト（引き分け）",
  draw: "引き分け",
};

const GREETING = "白番はあなたです。駒を動かすと、Stockfish が応手と講評を返します。";

const AI_FAILED = "（AI 解説を生成できませんでした）";

/** 対局終了時の結果表示 */
function resultLine(game: Chess): string {
  if (game.isCheckmate()) return game.turn() === "w" ? "チェックメイト — あなたの負け" : "チェックメイト — あなたの勝ち";
  if (game.isStalemate()) return "ステイルメイト — 引き分け";
  if (game.isDraw()) return "引き分け";
  return "対局終了";
}

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
  // コーチタブは 3 段構成: お知らせ / Stockfish の分析 / AI 解説
  const [coachText, setCoachText] = useState(GREETING);
  const [coachFacts, setCoachFacts] = useState("");
  const [coachAi, setCoachAi] = useState("");
  const [busy, setBusy] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [arrow, setArrow] = useState<[Square, Square] | null>(null);

  // 感想戦（棋譜レビュー）
  const [gameReview, setGameReview] = useState<GameReview | null>(null);
  const [reviewProgress, setReviewProgress] = useState<ReviewProgress | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [viewFen, setViewFen] = useState<string | null>(null);
  const cancelReview = useRef(false);

  // 手を戻す・リセットしたときに、進行中の解析や解説の結果を捨てるための世代番号
  const seqRef = useRef(0);
  // 現局面の解析結果をキャッシュ（講評の「指す前の評価」として再利用する）
  const cacheRef = useRef<{ fen: string; promise: Promise<SearchResult> } | null>(null);

  /** 解析結果ではないお知らせを表示する（分析・解説はクリアする） */
  const showMessage = useCallback((title: string, text: string) => {
    setCoachTitle(title);
    setCoachText(text);
    setCoachFacts("");
    setCoachAi("");
  }, []);

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
    if (!engineReady || busy || viewFen !== null || g.game.isGameOver()) return;
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
  }, [engineReady, busy, viewFen, g.fen, g.game, analyseFen]);

  /** ユーザーの着手後: 講評用の解析 → エンジンの応手 → 解説 */
  const afterUserMove = useCallback(
    async (userSan: string, fenBefore: string) => {
      const seq = ++seqRef.current;
      const stale = () => seq !== seqRef.current;
      setBusy(true);
      setTab("coach");
      setArrow(null);
      setViewIndex(null);
      setViewFen(null);
      setGameReview(null);
      setCoachTitle(`${userSan} の講評`);
      setCoachText("Stockfish が解析しています…");
      setCoachFacts("");
      setCoachAi("");

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
        setCoachText("");
        setCoachFacts(describeReview(result));
        if (g.game.isGameOver()) {
          setCoachTitle(`${resultLine(g.game)}（「感想戦」タブで棋譜を振り返れます）`);
        }
      } catch (e) {
        if (!stale()) {
          showMessage("エラー", `エラーが発生しました: ${e instanceof Error ? e.message : e}`);
        }
      } finally {
        if (!stale()) setBusy(false);
      }

      // 解説 AI が有効なときは、同じ解析結果の説明文を下に足す
      if (!result || stale() || !llm.ready) return;
      setExplaining(true);
      try {
        const text = await explainReview(result, (t) => {
          if (!stale()) setCoachAi(t);
        });
        if (!stale()) setCoachAi(text ?? AI_FAILED);
      } finally {
        if (!stale()) setExplaining(false);
      }
    },
    [analyseFen, g, level, llm.ready, showMessage],
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
    setGameReview(null);
    setViewIndex(null);
    setViewFen(null);
    g.undo(g.turn === "w" ? 2 : 1);
    showMessage("まった", "一手戻しました。じっくり考え直しましょう。");
  }, [g, showMessage]);

  const askHint = useCallback(async () => {
    if (busy || !engineReady || g.game.isGameOver()) return;
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;
    const fen = g.fen;
    setTab("coach");
    showMessage("ヒント", "Stockfish が候補手を探しています…");
    try {
      const result = await analyseFen(fen);
      if (stale()) return;
      const facts = {
        fen,
        score: mainScore(fen, result),
        candidates: candidates(fen, result, 3),
        inCheck: g.game.isCheck(),
      };
      setAnalysis(result);
      setScore(facts.score);
      setCoachText("");
      setCoachFacts(describeHint(facts));
      if (result.bestMove) {
        setArrow([result.bestMove.slice(0, 2) as Square, result.bestMove.slice(2, 4) as Square]);
      }
      if (!llm.ready) return;
      setExplaining(true);
      try {
        const text = await explainHint(facts, (t) => {
          if (!stale()) setCoachAi(t);
        });
        if (!stale()) setCoachAi(text ?? AI_FAILED);
      } finally {
        if (!stale()) setExplaining(false);
      }
    } catch (e) {
      if (!stale()) showMessage("ヒント", `エラー: ${e instanceof Error ? e.message : e}`);
    }
  }, [busy, engineReady, g, analyseFen, llm.ready, showMessage]);

  const reset = useCallback(() => {
    seqRef.current++;
    setBusy(false);
    setExplaining(false);
    setArrow(null);
    setReview(null);
    setScore(null);
    setAnalysis(null);
    setGameReview(null);
    setReviewProgress(null);
    setViewIndex(null);
    setViewFen(null);
    cacheRef.current = null;
    g.reset();
    void engine.newGame().catch(() => undefined);
    showMessage("Chess Sensei", `新しい対局です。${GREETING}`);
  }, [g, showMessage]);

  /** 棋譜全体を解析する */
  const startGameReview = useCallback(async () => {
    if (busy || !engineReady || g.history.length === 0) return;
    const seq = ++seqRef.current;
    const stale = () => seq !== seqRef.current;
    const history = [...g.history];
    cancelReview.current = false;
    setTab("review");
    setGameReview(null);
    setViewIndex(null);
    setViewFen(null);
    setArrow(null);
    setReviewProgress({ done: 0, total: history.length + 1 });
    try {
      const result = await reviewGame(history, {
        onProgress: (p) => {
          if (!stale()) setReviewProgress(p);
        },
        shouldStop: () => cancelReview.current || stale(),
      });
      if (!stale()) setGameReview(result);
    } catch (e) {
      if (!stale()) {
        showMessage("感想戦", `レビューに失敗しました: ${e instanceof Error ? e.message : e}`);
      }
    } finally {
      if (!stale()) setReviewProgress(null);
    }
  }, [busy, engineReady, g.history, showMessage]);

  const stopGameReview = useCallback(() => {
    cancelReview.current = true;
  }, []);

  /** レビューの手を選んでその局面を盤に再現する */
  const openReviewMove = useCallback(
    async (index: number) => {
      const gr = gameReview;
      const move = gr?.moves[index];
      if (!gr || !move) return;
      const seq = ++seqRef.current;
      const stale = () => seq !== seqRef.current;
      setViewIndex(index);
      setViewFen(gr.fens[index + 1]);
      setReview(move);
      setScore(move.scoreAfter);
      setArrow(sanToSquares(gr.fens[index], move.bestSan));
      setTab("coach");
      setCoachTitle(`${moveLabel(move)} の講評`);
      setCoachText("");
      setCoachFacts(describeReview(move));
      setCoachAi("");
      if (!llm.ready) return;
      setExplaining(true);
      try {
        const text = await explainReview(move, (t) => {
          if (!stale()) setCoachAi(t);
        });
        if (!stale()) setCoachAi(text ?? AI_FAILED);
      } finally {
        if (!stale()) setExplaining(false);
      }
    },
    [gameReview, llm.ready],
  );

  /** 感想戦: 表示中の局面まで本譜を巻き戻して指し直す */
  const resumeFromView = useCallback(() => {
    const move = viewIndex !== null ? gameReview?.moves[viewIndex] : null;
    if (viewIndex === null || !move) return;
    seqRef.current++;
    // 白（自分）の手はその手を指す前、黒の手はその手の後に戻す（常に自分の手番にする）
    const keep = move.color === "w" ? viewIndex : viewIndex + 1;
    g.undo(g.history.length - keep);
    setViewIndex(null);
    setViewFen(null);
    setGameReview(null);
    setArrow(null);
    setReview(null);
    setBusy(false);
    setExplaining(false);
    setTab("coach");
    showMessage("感想戦", "この局面から指し直せます。別の手を試してみましょう。");
  }, [g, gameReview, viewIndex, showMessage]);

  /** 本譜の最新局面に戻る */
  const backToGame = useCallback(() => {
    seqRef.current++;
    setViewIndex(null);
    setViewFen(null);
    setArrow(null);
    setReview(null);
    setExplaining(false);
    showMessage("Chess Sensei", "本譜の局面に戻りました。");
  }, [showMessage]);

  const statusText = STATUS_LABEL[g.status];
  const reviewing = reviewProgress !== null;
  const canPlay =
    engineReady && !busy && !reviewing && viewFen === null && g.turn === "w" && !g.game.isGameOver();

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
            position={viewFen ?? g.fen}
            onPieceDrop={onDrop}
            arePiecesDraggable={canPlay}
            customArrows={arrow ? [arrow] : []}
            customBoardStyle={{ borderRadius: "8px" }}
            customDarkSquareStyle={{ backgroundColor: "#7c93b2" }}
            customLightSquareStyle={{ backgroundColor: "#e8edf4" }}
          />
          <div className="controls">
            <button
              onClick={takeBack}
              disabled={busy || reviewing || viewFen !== null || g.history.length === 0}
            >
              ↩ まった
            </button>
            <button onClick={() => void askHint()} disabled={!canPlay}>
              💡 ヒント
            </button>
            <button onClick={() => setTab("review")} disabled={g.history.length === 0}>
              📋 感想戦
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
            <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")}>
              感想戦{reviewing && "…"}
            </button>
          </nav>
          <div className="panel-body">
            {tab === "coach" && (
              <>
                <h2 className="coach-title">{coachTitle}</h2>
                {coachText && <p className="coach-text">{coachText}</p>}
                {coachFacts && (
                  <section className="coach-section">
                    <h3>♟ Stockfish の分析</h3>
                    <p className="coach-text">{coachFacts}</p>
                  </section>
                )}
                {(coachAi || explaining) && (
                  <section className="coach-section">
                    <h3>🗣 AI 解説{explaining && "（生成中…）"}</h3>
                    <p className="coach-text">{coachAi || "…"}</p>
                  </section>
                )}
                {viewFen !== null && (
                  <div className="llm-actions">
                    <button className="primary" onClick={resumeFromView}>
                      ▶ ここから指し直す
                    </button>
                    <button onClick={backToGame}>本譜に戻る</button>
                  </div>
                )}
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
            {tab === "review" && (
              <ReviewPanel
                review={gameReview}
                progress={reviewProgress}
                selected={viewIndex}
                onSelect={(i) => void openReviewMove(i)}
                onStart={() => void startGameReview()}
                onCancel={stopGameReview}
                canStart={engineReady && !busy && g.history.length > 0}
              />
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
