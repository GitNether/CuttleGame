import { describe, expect, it } from "vitest";
import { actJack, actOneOff, isProtected, jackTargets, nineTargets, twoTargets } from "../src";
import { C, D, H, J, Q, S, baseState, card, stack } from "./helpers";

describe("Queen protection edge cases", () => {
  it("a lone queen does not protect itself — it can be targeted by a 2", () => {
    const queen = card(Q, H);
    const s = baseState({
      hands: { p1: [card(2, C)], p2: [] },
      royals: { p1: [], p2: [{ c: queen, g: false }] },
    });
    expect(isProtected(s, "p2", queen)).toBe(false);
    const targets = twoTargets(s, "p1");
    expect(targets).toContainEqual({ kind: "royal", p: "p2", i: 0 });
    expect(actOneOff(s, "p1", card(2, C), { kind: "royal", p: "p2", i: 0 })).toBe(true);
    expect(s.royals.p2).toHaveLength(0);
    expect(s.scrap).toEqual(expect.arrayContaining([card(2, C), queen]));
  });

  it("double queens protect each other — neither can be targeted", () => {
    const q1 = card(Q, H),
      q2 = card(Q, S);
    const s = baseState({
      hands: { p1: [card(2, C)], p2: [] },
      royals: {
        p1: [],
        p2: [
          { c: q1, g: false },
          { c: q2, g: false },
        ],
      },
    });
    expect(isProtected(s, "p2", q1)).toBe(true);
    expect(isProtected(s, "p2", q2)).toBe(true);
    expect(twoTargets(s, "p1")).toHaveLength(0);
    expect(nineTargets(s, "p1")).toHaveLength(0);
  });

  it("a queen protects the owner's other royals and jacks from 2s and 9s", () => {
    const s = baseState({
      hands: { p1: [card(2, C), card(9, C)], p2: [] },
      royals: {
        p1: [],
        p2: [
          { c: card(Q, H), g: false },
          { c: card(13, S), g: false }, // king
          { c: card(8, D), g: true }, // glasses
        ],
      },
      points: {
        p1: [],
        p2: [stack(card(10, H), "p1", [card(J, C)])], // stolen from p1
      },
    });
    // Only the queen itself is targetable
    expect(twoTargets(s, "p1")).toEqual([{ kind: "royal", p: "p2", i: 0 }]);
    expect(nineTargets(s, "p1")).toEqual([{ kind: "royal", p: "p2", i: 0 }]);
  });

  it("your own queen never restricts your own targets", () => {
    const s = baseState({
      hands: { p1: [card(9, C)], p2: [] },
      royals: {
        p1: [
          { c: card(Q, H), g: false },
          { c: card(13, C), g: false },
        ],
        p2: [],
      },
      points: { p1: [stack(card(5, D), "p1")], p2: [] },
    });
    // 9 can bounce any of p1's own permanents despite p1's queen
    expect(nineTargets(s, "p1")).toEqual(
      expect.arrayContaining([
        { kind: "royal", p: "p1", i: 0 },
        { kind: "royal", p: "p1", i: 1 },
        { kind: "point", p: "p1", i: 0 },
      ])
    );
  });

  it("a queen blocks jacks entirely", () => {
    const s = baseState({
      hands: { p1: [card(J, D)], p2: [] },
      royals: { p1: [], p2: [{ c: card(Q, C), g: false }] },
      points: { p1: [], p2: [stack(card(10, H), "p2")] },
    });
    expect(jackTargets(s, "p1")).toEqual([]);
    expect(actJack(s, "p1", card(J, D), 0)).toBe(false);
  });

  it("a queen does not protect point cards from scuttles or an Ace", () => {
    const s = baseState({
      hands: { p1: [card(1, C)], p2: [] },
      royals: { p1: [], p2: [{ c: card(Q, C), g: false }] },
      points: { p1: [], p2: [stack(card(10, H), "p2")] },
    });
    expect(actOneOff(s, "p1", card(1, C), null)).toBe(true);
    expect(s.points.p2).toHaveLength(0); // ace went through
    expect(s.royals.p2).toHaveLength(1); // queen untouched
  });
});
