import { describe, expect, it } from "vitest";
import {
  actDraw,
  actJoinAsP2,
  actPoint,
  actRematch,
  applyAction,
  clone,
  newGame,
} from "../src";
import { C, D, H, baseState, card, seededRng, stack } from "./helpers";

describe("dealing", () => {
  it("dealer gets 6, other player 5 and goes first; 41 cards remain", () => {
    const s = newGame({ p1: "Alice", p2: "Bob" }, "p1", seededRng());
    expect(s.hands.p1).toHaveLength(6);
    expect(s.hands.p2).toHaveLength(5);
    expect(s.deck).toHaveLength(41);
    expect(s.turn).toBe("p2");
    expect(s.phase).toBe("play");
    // all 52 cards accounted for, no duplicates
    const all = [...s.deck, ...s.hands.p1, ...s.hands.p2];
    expect(new Set(all).size).toBe(52);
  });

  it("a room without p2 starts in waiting; joining starts play", () => {
    const s = newGame({ p1: "Alice", p2: "" }, "p1", seededRng());
    expect(s.phase).toBe("waiting");
    expect(actJoinAsP2(s, "Bob")).toBe(true);
    expect(s.phase).toBe("play");
    expect(s.names.p2).toBe("Bob");
    expect(actJoinAsP2(s, "Carol")).toBe(false); // seat taken
  });
});

describe("empty deck → pass; three passes = draw", () => {
  it("passing flips the turn and three consecutive passes end in a draw", () => {
    const s = baseState({ deck: [] });
    expect(actDraw(s, "p1")).toBe(true);
    expect(s.passes).toBe(1);
    expect(s.turn).toBe("p2");
    actDraw(s, "p2");
    expect(s.passes).toBe(2);
    actDraw(s, "p1");
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("draw");
  });

  it("playing a card resets the pass counter", () => {
    const s = baseState({ deck: [], hands: { p1: [], p2: [card(5, D)] } });
    actDraw(s, "p1"); // pass 1
    actPoint(s, "p2", card(5, D)); // resets
    expect(s.passes).toBe(0);
    actDraw(s, "p1"); // pass 1 again
    actDraw(s, "p2"); // pass 2
    actDraw(s, "p1"); // pass 3 → draw
    expect(s.winner).toBe("draw");
  });
});

describe("rematch", () => {
  it("only the winner may start it; the dealer alternates", () => {
    const s = baseState({ phase: "over", winner: "p2", dealer: "p1" });
    expect(actRematch(s, "p1", seededRng())).toBe(false);
    expect(actRematch(s, "p2", seededRng())).toBe(true);
    expect(s.dealer).toBe("p2");
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p1"); // non-dealer starts
    expect(s.hands.p2).toHaveLength(6);
    expect(s.hands.p1).toHaveLength(5);
    expect(s.winner).toBeNull();
    expect(s.log[0]).toContain("Rematch");
  });

  it("after a draw, only p1 may start the rematch", () => {
    const s = baseState({ phase: "over", winner: "draw", dealer: "p2" });
    expect(actRematch(s, "p2", seededRng())).toBe(false);
    expect(actRematch(s, "p1", seededRng())).toBe(true);
    expect(s.dealer).toBe("p1");
  });

  it("two rematch presses cannot deal twice (guard: phase must be over)", () => {
    const s = baseState({ phase: "over", winner: "p1", dealer: "p1" });
    expect(actRematch(s, "p1", seededRng(1))).toBe(true);
    const snapshot = JSON.stringify(s);
    expect(actRematch(s, "p1", seededRng(2))).toBe(false); // phase is now "play"
    expect(JSON.stringify(s)).toBe(snapshot); // second press changed nothing
  });
});

describe("guards against double-taps and stale actions", () => {
  it("replaying the same point action fails once the card left the hand", () => {
    const s = baseState({ hands: { p1: [card(9, H)], p2: [] }, deck: [card(3, C)] });
    const replay = clone(s); // what a stale client would try to re-apply
    expect(actPoint(s, "p1", card(9, H))).toBe(true);
    // double-tap on the fresh state: card gone AND not p1's turn
    expect(actPoint(s, "p1", card(9, H))).toBe(false);
    // the guard also protects the cloned path used by the sync layer
    expect(actPoint(replay, "p1", card(9, H))).toBe(true); // only on the stale base
  });

  it("acting out of turn or in the wrong phase is refused", () => {
    const s = baseState({
      hands: { p1: [card(9, H)], p2: [card(8, H)] },
      phase: "counter",
      actor: "p2",
      pending: { c: card(1, C), by: "p1", target: null, counters: [], fromSeven: false },
    });
    expect(actPoint(s, "p2", card(8, H))).toBe(false); // wrong phase
    expect(actDraw(s, "p1")).toBe(false);
  });
});

describe("applyAction wrapper", () => {
  it("routes serialized actions through the same guards", () => {
    const s = baseState({
      hands: { p1: [card(9, H)], p2: [] },
      points: { p1: [], p2: [stack(card(5, C), "p2")] },
    });
    expect(applyAction(s, { type: "scuttle", by: "p1", card: card(9, H), targetIdx: 0 })).toBe(
      true
    );
    expect(s.points.p2).toHaveLength(0);
    expect(applyAction(s, { type: "draw", by: "p1" })).toBe(false); // p2's turn now
  });
});
