import {
  applyAction,
  chooseAction,
  clone,
  newGame,
  type GameState,
  type PlayerId,
} from "@cuttle/engine";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GameBoard } from "../game/GameBoard";
import { whoActsNext } from "../sync";

const HUMAN: PlayerId = "p1";
const AI: PlayerId = "p2";
const AI_THINK_MS = 1300; // brief pause so the AI's moves feel deliberate

interface Props {
  name: string;
  onLeave: () => void;
}

/** Single-player game against the built-in AI. Entirely local — no Firebase,
 *  works offline. Reuses GameBoard for the UI. */
export function OfflineGameScreen({ name, onLeave }: Props) {
  // AI deals (holds 6), so the human goes first. Avoid the default "You",
  // which reads awkwardly as "You (you)" / "You wins!".
  const [state, setState] = useState<GameState>(() =>
    newGame({ p1: name.trim() || "Player", p2: "Computer" }, AI)
  );
  const [stateKey, setStateKey] = useState(0);
  const [thinking, setThinking] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback((mutator: (g: GameState) => boolean): boolean => {
    const g = clone(stateRef.current);
    if (mutator(g) === false) return false;
    stateRef.current = g;
    setState(g);
    setStateKey((k) => k + 1);
    return true;
  }, []);

  // Drive the AI: whenever the position hands the move to the computer, let it
  // think briefly and act. Re-runs on every state advance, so counter chains
  // and consecutive AI turns resolve step by step.
  useEffect(() => {
    const s = stateRef.current;
    if (s.phase === "over" || s.phase === "waiting") return;
    if (whoActsNext(s) !== AI) return;
    setThinking(true);
    const t = setTimeout(() => {
      const action = chooseAction(stateRef.current, AI);
      if (action) apply((g) => applyAction(g, action));
      setThinking(false);
    }, AI_THINK_MS);
    return () => {
      clearTimeout(t);
      setThinking(false);
    };
  }, [stateKey, apply]);

  return (
    <GameBoard
      state={state}
      me={HUMAN}
      stateKey={stateKey}
      busy={thinking}
      commit={(mutator) => apply(mutator)}
      onLeave={onLeave}
      localControlsBothSeats
    />
  );
}
