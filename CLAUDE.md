# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Chess Sensei is a frontend-only chess learning web app. A Gemma model (Gemma 3n E2B, ~2GB `.task` file) runs entirely in the browser via MediaPipe LLM Inference (WebGPU, with CPU fallback) — there is no server or backend API. The LLM plays as Black, gives per-move advice, and explains positions on demand. All UI text, prompts, and code comments are in Japanese; follow that convention.

## Commands

Uses **bun** as the package manager (see `bun.lock` and the deploy workflow).

```bash
bun install          # install dependencies
bun run dev          # Vite dev server
bun run build        # tsc --noEmit (type check) && vite build
bun run preview      # preview the production build
```

There are no tests and no linter configured. `bun run build` (which runs `tsc --noEmit` under strict mode) is the only verification step — run it to validate changes.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds with `GITHUB_PAGES=true` (sets Vite `base` to `/chess-sensei/` in `vite.config.ts`) and deploys `dist/` to GitHub Pages.

## Architecture

Data flows in one direction: UI (`App.tsx`) → game state (`src/game`) → LLM layer (`src/llm`).

- **`src/App.tsx`** — the single page. Owns UI state (tabs, coach text, busy flag) and orchestrates the turn cycle: after each user move, it asks the LLM for Black's reply (`pickAiMove`), then optionally streams advice about the user's move. A `useRef` sequence counter (`adviceSeq`) invalidates in-flight LLM responses when the user resets or takes back a move — increment it to cancel pending work.

- **`src/game/useChessGame.ts`** — wraps a `chess.js` instance (held in a ref) as a React hook. Mutations go through `move`/`undo`/`reset`, which re-sync `fen`/`history` state. The raw `Chess` instance is exposed as `game` for read-only queries; don't mutate it directly or React won't re-render.

- **`src/llm/engine.ts`** — the only file that touches MediaPipe. Handles model download (with progress, Cache API caching under `MODEL_CACHE` — bump the version string to invalidate corrupt caches), backend selection (WebGPU vs CPU), Gemma chat-template wrapping, and streaming generation. `generate()` includes token-loop detection (`loopUnitEnd`/`trimLoop`) that cancels and trims runaway repeated output — a known failure mode of the small model. Sampling options are only re-applied when they change (`applySampling`) because `setOptions` is expensive.

- **`src/llm/coach.ts`** — task-level API: `pickAiMove`, `adviseOnMove`, `explainPosition`. Each task has its own `Sampling` preset (lower temperature for advice to curb hallucination). `pickAiMove` parses `思考:`/`指し手:` from the output, validates the move against `game.moves()`, and falls back to a heuristic (check > best capture > random) when the LLM produces no legal move — never trust the LLM to output a legal move.

- **`src/llm/prompts.ts`** — Japanese prompt builders. Every prompt embeds the position (`describePosition`: FEN, turn, recent moves, full legal-move list) and the `MOVE_RULE` constraint restricting mentioned moves to the legal-move list, to suppress hallucinated moves. Keep new prompts consistent with this pattern.

- **`src/components/ModelLoader.tsx`** — startup screen. Auto-loads `DEFAULT_MODEL_URL` (a non-gated Hugging Face model, chosen because lighter Gemma variants are gated and need auth); shows a manual `.task` file picker only on failure.

## Key constraints

- The LLM is small and unreliable: any feature consuming its output must validate against `chess.js` and degrade gracefully (see the fallback patterns in `coach.ts` and `engine.ts`).
- `LlmInference` APIs vary by runtime version — guard optional calls (e.g. the `typeof llm.cancelProcessing === "function"` check in `engine.ts`) rather than calling them unconditionally.
- The user always plays White; the LLM always plays Black. Game-over and turn checks in `App.tsx` gate all interaction.
