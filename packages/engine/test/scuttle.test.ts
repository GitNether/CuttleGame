import { describe, expect, it } from "vitest";
import { actScuttle, cardPower, scuttleTargets } from "../src";
import { A, C, D, H, S, baseState, card, stack } from "./helpers";

describe("scuttle comparisons (rank first, then suit ♣<♦<♥<♠)", () => {
  it("orders cards by rank then suit", () => {
    expect(cardPower(card(9, S))).toBeGreaterThan(cardPower(card(9, H)));
    expect(cardPower(card(9, H))).toBeGreaterThan(cardPower(card(9, D)));
    expect(cardPower(card(9, D))).toBeGreaterThan(cardPower(card(9, C)));
    expect(cardPower(card(10, C))).toBeGreaterThan(cardPower(card(9, S)));
  });

  it("higher rank scuttles lower rank", () => {
    const s = baseState({
      hands: { p1: [card(10, C)], p2: [] },
      points: { p1: [], p2: [stack(card(9, S), "p2")] },
    });
    expect(actScuttle(s, "p1", card(10, C), 0)).toBe(true);
    expect(s.points.p2).toHaveLength(0);
    expect(s.scrap).toContain(card(10, C));
    expect(s.scrap).toContain(card(9, S));
    expect(s.turn).toBe("p2");
  });

  it("equal rank: higher suit wins, lower suit is refused", () => {
    const s = baseState({
      hands: { p1: [card(9, S), card(9, C)], p2: [] },
      points: { p1: [], p2: [stack(card(9, H), "p2")] },
    });
    expect(actScuttle(s, "p1", card(9, C), 0)).toBe(false); // ♣ < ♥
    expect(s.points.p2).toHaveLength(1);
    expect(actScuttle(s, "p1", card(9, S), 0)).toBe(true); // ♠ > ♥
  });

  it("equal card power can never happen, but equal power is refused", () => {
    const s = baseState({
      hands: { p1: [card(5, D)], p2: [] },
      points: { p1: [], p2: [stack(card(6, C), "p2")] },
    });
    expect(actScuttle(s, "p1", card(5, D), 0)).toBe(false);
  });

  it("scuttling a jacked stack scraps the jacks with it", () => {
    const jack = card(11, C);
    const s = baseState({
      hands: { p1: [card(10, S)], p2: [] },
      // p2 stole p1's 9♥ with a jack; p1 scuttles it right back
      points: { p1: [], p2: [stack(card(9, H), "p1", [jack])] },
    });
    expect(actScuttle(s, "p1", card(10, S), 0)).toBe(true);
    expect(s.scrap).toEqual(expect.arrayContaining([card(10, S), card(9, H), jack]));
  });

  it("scuttleTargets lists exactly the beatable stacks", () => {
    const s = baseState({
      points: {
        p1: [],
        p2: [stack(card(3, C), "p2"), stack(card(8, S), "p2"), stack(card(8, C), "p2")],
      },
    });
    expect(scuttleTargets(s, "p1", card(8, D))).toEqual([0, 2]);
    expect(scuttleTargets(s, "p1", card(A, S))).toEqual([]);
  });

  it("guards: wrong turn, card not in hand, bad target index", () => {
    const s = baseState({
      turn: "p2",
      hands: { p1: [card(10, C)], p2: [card(10, D)] },
      points: { p1: [stack(card(4, C), "p1")], p2: [stack(card(4, D), "p2")] },
    });
    expect(actScuttle(s, "p1", card(10, C), 0)).toBe(false); // not p1's turn
    expect(actScuttle(s, "p2", card(10, C), 0)).toBe(false); // not p2's card
    expect(actScuttle(s, "p2", card(10, D), 5)).toBe(false); // no such stack
    expect(actScuttle(s, "p2", card(10, D), 0)).toBe(true);
  });
});
