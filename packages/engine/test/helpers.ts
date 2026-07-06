import { cardId, type Card } from "../src/cards";
import type { GameState, PlayerId, PointStack } from "../src/types";

/** Deterministic RNG for tests (LCG). */
export function seededRng(seed = 42): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** Bare in-progress game with empty zones; override what the test needs. */
export function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "play",
    turn: "p1",
    actor: null,
    pending: null,
    sevenCard: null,
    discardNeed: 0,
    deck: [],
    scrap: [],
    hands: { p1: [], p2: [] },
    points: { p1: [], p2: [] },
    royals: { p1: [], p2: [] },
    names: { p1: "Alice", p2: "Bob" },
    dealer: "p1",
    passes: 0,
    winner: null,
    log: [],
    ...overrides,
  };
}

export const stack = (c: Card, base: PlayerId, jacks: Card[] = []): PointStack => ({
  c,
  jacks,
  base,
});

// Suit indices
export const C = 0, D = 1, H = 2, S = 3;
// Ranks
export const A = 1, J = 11, Q = 12, K = 13;

export const card = cardId;
