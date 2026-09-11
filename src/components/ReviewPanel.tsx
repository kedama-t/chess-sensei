import { QUALITY_LABEL, type MoveReview, type Quality } from "../engine/analysis";
import type { GameReview, ReviewProgress, SideSummary } from "../engine/gameReview";

type Props = {
  review: GameReview | null;
  progress: ReviewProgress | null;
  /** 感想戦で選択中の手（本譜のプライ番号） */
  selected: number | null;
  onSelect: (index: number) => void;
  onStart: () => void;
  onCancel: () => void;
  canStart: boolean;
};

const SHOWN_QUALITIES: Quality[] = ["best", "good", "inaccuracy", "mistake", "blunder"];

function Summary({ label, summary }: { label: string; summary: SideSummary }) {
  return (
    <div className="review-side">
      <div className="review-side-head">
        <span>{label}</span>
        <strong>{summary.accuracy.toFixed(1)}%</strong>
      </div>
      <p className="muted">
        {summary.moves} 手／平均損失 {summary.acpl} センチポーン
      </p>
      <ul className="review-counts">
        {SHOWN_QUALITIES.filter((q) => summary.counts[q] > 0).map((q) => (
          <li key={q} className={`badge q-${q}`}>
            {QUALITY_LABEL[q].replace(/（.*）/, "")} {summary.counts[q]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 棋譜レビュー（感想戦）のパネル */
export function ReviewPanel({
  review,
  progress,
  selected,
  onSelect,
  onStart,
  onCancel,
  canStart,
}: Props) {
  if (progress) {
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
      <div className="review">
        <p className="coach-text">
          棋譜を解析しています… {progress.done} / {progress.total} 局面
        </p>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <button onClick={onCancel}>中断する</button>
      </div>
    );
  }

  if (!review) {
    return (
      <div className="review">
        <p className="coach-text">
          対局が終わったら（途中でも）棋譜全体を Stockfish で解析して、
          1 手ごとの精度と悪手を振り返れます。手をクリックするとその局面に戻り、
          そこから指し直して感想戦ができます。
        </p>
        <button className="primary" onClick={onStart} disabled={!canStart}>
          📋 棋譜をレビュー
        </button>
        {!canStart && <p className="muted">まず何手か指してください。</p>}
      </div>
    );
  }

  return (
    <div className="review">
      {review.partial && <p className="muted">※ 中断したため、途中までの結果です。</p>}
      <p className="muted">手をクリックすると、その局面と講評を表示します。</p>
      <div className="review-summaries">
        <Summary label="あなた（白）" summary={review.white} />
        <Summary label="Stockfish（黒）" summary={review.black} />
      </div>
      <ol className="review-moves">
        {pairs(review.moves).map(([w, b], row) => (
          <li key={row}>
            <span className="review-no">{row + 1}.</span>
            <MoveCell move={w} index={row * 2} selected={selected} onSelect={onSelect} />
            <MoveCell move={b} index={row * 2 + 1} selected={selected} onSelect={onSelect} />
          </li>
        ))}
      </ol>
      <div className="llm-actions">
        <button onClick={onStart}>🔄 解析し直す</button>
      </div>
    </div>
  );
}

function MoveCell({
  move,
  index,
  selected,
  onSelect,
}: {
  move: MoveReview | undefined;
  index: number;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  if (!move) return <span className="review-cell" />;
  return (
    <button
      className={`review-cell q-${move.quality} ${selected === index ? "selected" : ""}`}
      onClick={() => onSelect(index)}
      title={`${QUALITY_LABEL[move.quality]}／精度 ${move.accuracy.toFixed(0)}%`}
    >
      <span className="review-san">{move.san}</span>
      {/* 損失の表示は最善手以外だけ（誤差レベルの -0.0 を並べない） */}
      {move.quality !== "best" && (
        <span className="review-loss">-{(move.cpLoss / 100).toFixed(1)}</span>
      )}
    </button>
  );
}

function pairs(moves: MoveReview[]): [MoveReview?, MoveReview?][] {
  const out: [MoveReview?, MoveReview?][] = [];
  for (let i = 0; i < moves.length; i += 2) out.push([moves[i], moves[i + 1]]);
  return out;
}
