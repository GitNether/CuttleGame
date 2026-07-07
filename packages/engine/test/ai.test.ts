import { describe, expect, it } from "vitest";
import { applyAction, chooseAction, rankOf } from "../src";
import { A, C, D, H, J, K, Q, S, baseState, card, seededRng, stack } from "./helpers";

const rng = () => seededRng(7);

describe("AI move selection", () => {
  it("takes a winning point play when one is available", () => {
    const s = baseState({
      turn: "p2",
      hands: { p1: [], p2: [card(10, H), card(3, C)] },
      points: { p1: [], p2: [stack(card(10, S), "p2"), stack(card(A, C), "p2")] },
    });
    // p2 has 11 on board, goal 21; playing 10 reaches 21 → win
    const action = chooseAction(s, "p2", rng());
    expect(action).toEqual({ type: "point", by: "p2", card: card(10, H), fromSeven: false });
    applyAction(s, action!, rng());
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("p2");
  });

  it("counters a lethal Ace that would wipe its winning board", () => {
    // p1 plays an Ace that scraps all points; p2 is about to lose its lead and
    // holds a 2 → should counter.
    const s = baseState({
      turn: "p1",
      hands: { p1: [card(A, C)], p2: [card(2, H)] },
      points: { p1: [], p2: [stack(card(10, S), "p2"), stack(card(9, S), "p2")] },
    });
    applyAction(s, { type: "oneOff", by: "p1", card: card(A, C), target: null });
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p2");
    const action = chooseAction(s, "p2", rng());
    expect(action).toEqual({ type: "counter", by: "p2", card: card(2, H) });
  });

  it("does not waste a 2 countering a harmless one-off", () => {
    // p1 plays a 5 (draw two) — no board impact on p2; p2 shouldn't counter.
    const s = baseState({
      turn: "p1",
      deck: [card(9, D), card(8, D)],
      hands: { p1: [card(5, C)], p2: [card(2, H)] },
    });
    applyAction(s, { type: "oneOff", by: "p1", card: card(5, C), target: null });
    expect(s.phase).toBe("counter");
    const action = chooseAction(s, "p2", rng());
    expect(action).toEqual({ type: "declineCounter", by: "p2" });
  });

  it("discards its least useful cards to a Four, keeping 2s and royals", () => {
    const s = baseState({
      phase: "discard",
      actor: "p2",
      discardNeed: 2,
      hands: { p1: [], p2: [card(2, C), card(3, D), card(4, H), card(K, S)] },
    });
    const action = chooseAction(s, "p2", rng());
    expect(action?.type).toBe("discard");
    if (action?.type === "discard") {
      expect(action.cards).toHaveLength(2);
      // keeps the 2 and the king
      expect(action.cards).not.toContain(card(2, C));
      expect(action.cards).not.toContain(card(K, S));
      expect(action.cards).toEqual(expect.arrayContaining([card(3, D), card(4, H)]));
    }
  });

  it("disrupts instead of padding points when the opponent is about to win", () => {
    // p1 (human) has 18 on board, goal 21 — one card from winning. p2 (AI)
    // holds only a 10, which can either pad its own points (useless — it can't
    // win first) or scuttle p1's biggest card. It should scuttle.
    const s = baseState({
      turn: "p2",
      hands: { p1: [card(3, C)], p2: [card(10, S)] },
      points: {
        p1: [stack(card(10, H), "p1"), stack(card(8, H), "p1")],
        p2: [],
      },
    });
    const action = chooseAction(s, "p2", rng());
    expect(action?.type).toBe("scuttle");
  });

  it("gambles a Seven rather than a dead point play when losing", () => {
    // p1 about to win; p2's only tools are a 7 (gamble) and an 8 that can only
    // pad points (can't scuttle p1's higher cards). It should play the 7 to
    // dig for a disruptive card instead of the dead point play.
    const s = baseState({
      turn: "p2",
      deck: [card(A, D), card(5, D)],
      hands: { p1: [card(3, C)], p2: [card(7, S), card(8, D)] },
      points: { p1: [stack(card(10, H), "p1"), stack(card(9, H), "p1")], p2: [] },
    });
    const action = chooseAction(s, "p2", rng());
    expect(action).toEqual({ type: "oneOff", by: "p2", card: card(7, S), target: null, fromSeven: false });
  });

  it("holds a valuable Ace instead of spending it for a small gain", () => {
    // Opponent has only 3 board points — wiping them with an Ace is a waste.
    // The AI should develop (points/scuttle) and keep the Ace for later.
    const s = baseState({
      turn: "p2",
      deck: [card(5, D), card(6, D)],
      hands: { p1: [card(K, C)], p2: [card(A, C), card(9, S)] },
      points: { p1: [stack(card(3, C), "p1")], p2: [] },
    });
    const action = chooseAction(s, "p2", rng());
    const playsTheAce = action?.type === "oneOff" && rankOf(action.card) === 1;
    expect(playsTheAce).toBe(false);
  });

  it("returns null when it isn't the AI's move", () => {
    const s = baseState({ turn: "p1", hands: { p1: [card(5, C)], p2: [card(9, D)] } });
    expect(chooseAction(s, "p2", rng())).toBeNull();
  });

  it("always produces a legal action on its own turn (self-play smoke test)", () => {
    // Play a full game AI vs AI and assert it always terminates with a result.
    let s = baseState({
      turn: "p2",
      deck: Array.from({ length: 40 }, (_, i) => (i + 8) % 52),
      hands: {
        p1: [card(3, C), card(J, D), card(Q, H), card(5, S)],
        p2: [card(4, C), card(K, D), card(2, H), card(8, S)],
      },
    });
    let steps = 0;
    while (s.phase !== "over" && steps++ < 500) {
      const actor =
        s.phase === "play" ? s.turn : s.phase === "waiting" ? null : s.actor;
      if (!actor) break;
      const action = chooseAction(s, actor, seededRng(steps));
      expect(action).not.toBeNull();
      const ok = applyAction(s, action!, seededRng(steps));
      expect(ok).toBe(true);
    }
    expect(steps).toBeLessThan(500); // it terminates
    expect(s.phase).toBe("over");
  });
});
