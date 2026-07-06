import { describe, expect, it } from "vitest";
import { actJack, actOneOff, actPoint, actRoyal, goalOf, kingsOf, pointsOf } from "../src";
import { C, D, H, J, K, Q, S, baseState, card, stack } from "./helpers";

describe("jack stack control flipping", () => {
  it("steal, steal back, steal again — control follows jack parity, base never changes", () => {
    const ten = card(10, H);
    const j1 = card(J, C),
      j2 = card(J, D),
      j3 = card(J, H);
    const s = baseState({
      hands: { p1: [j2], p2: [j1, j3] },
      points: { p1: [stack(ten, "p1")], p2: [] },
      turn: "p2",
    });
    // p2 steals p1's 10
    expect(actJack(s, "p2", j1, 0)).toBe(true);
    expect(s.points.p1).toHaveLength(0);
    expect(s.points.p2[0]).toMatchObject({ c: ten, jacks: [j1], base: "p1" });
    expect(pointsOf(s, "p2")).toBe(10);

    // p1 steals it back
    expect(actJack(s, "p1", j2, 0)).toBe(true);
    expect(s.points.p1[0]).toMatchObject({ c: ten, jacks: [j1, j2], base: "p1" });
    expect(pointsOf(s, "p1")).toBe(10);

    // p2 steals it a third time
    expect(actJack(s, "p2", j3, 0)).toBe(true);
    expect(s.points.p2[0]).toMatchObject({ c: ten, jacks: [j1, j2, j3], base: "p1" });
  });

  it("a 2 one-off on the top jack flips control back and scraps only that jack", () => {
    const ten = card(10, H);
    const j1 = card(J, C),
      j2 = card(J, D);
    const s = baseState({
      hands: { p1: [card(2, S)], p2: [] },
      // p2 controls p1's ten under two jacks (p2 jacked, p1 jacked back, p2 re-jacked
      // would be 3 — here: two jacks means p1 jacked it from... keep it simple:
      // stack currently controlled by p2 with jacks [j1, j2])
      points: { p1: [], p2: [stack(ten, "p1", [j1, j2])] },
    });
    expect(actOneOff(s, "p1", card(2, S), { kind: "jack", p: "p2", i: 0 })).toBe(true);
    expect(s.points.p1[0]).toMatchObject({ c: ten, jacks: [j1], base: "p1" });
    expect(s.scrap).toContain(j2);
    expect(s.scrap).not.toContain(j1);
  });
});

describe("Six one-off: table wipe with stolen cards reverting", () => {
  it("scraps all royals/glasses/jacks and returns stolen cards to their base owner", () => {
    const stolenByP2 = card(10, H); // base p1, controlled by p2
    const stolenByP1 = card(9, C); // base p2, controlled by p1
    const ownP1 = card(4, D); // p1's own, never stolen
    const j1 = card(J, C),
      j2 = card(J, D),
      j3 = card(J, H);
    const s = baseState({
      hands: { p1: [card(6, S)], p2: [] },
      royals: {
        p1: [{ c: card(K, C), g: false }],
        p2: [
          { c: card(Q, H), g: false },
          { c: card(8, S), g: true },
        ],
      },
      points: {
        p1: [stack(ownP1, "p1"), stack(stolenByP1, "p2", [j1])],
        p2: [stack(stolenByP2, "p1", [j2, j3])],
      },
    });
    expect(actOneOff(s, "p1", card(6, S), null)).toBe(true);
    // all royals and jacks scrapped
    expect(s.scrap).toEqual(
      expect.arrayContaining([card(6, S), card(K, C), card(Q, H), card(8, S), j1, j2, j3])
    );
    expect(s.royals.p1).toHaveLength(0);
    expect(s.royals.p2).toHaveLength(0);
    // stolen cards went home, own card stayed
    expect(s.points.p1.map((st) => st.c).sort()).toEqual([ownP1, stolenByP2].sort());
    expect(s.points.p2.map((st) => st.c)).toEqual([stolenByP1]);
    // all jack arrays emptied
    for (const p of ["p1", "p2"] as const)
      for (const st of s.points[p]) expect(st.jacks).toHaveLength(0);
  });

  it("a card stolen and re-stolen back (even jacks) stays with its base owner", () => {
    const ten = card(10, H);
    const s = baseState({
      hands: { p1: [], p2: [card(6, C)] },
      turn: "p2",
      points: { p1: [stack(ten, "p1", [card(J, C), card(J, D)])], p2: [] },
    });
    expect(actOneOff(s, "p2", card(6, C), null)).toBe(true);
    expect(s.points.p1.map((st) => st.c)).toEqual([ten]);
    expect(s.points.p1[0].jacks).toHaveLength(0);
  });
});

describe("King goal thresholds", () => {
  it.each([
    [0, 21],
    [1, 14],
    [2, 10],
    [3, 7],
    [4, 5],
  ])("%i kings → goal %i", (kings, goal) => {
    const s = baseState({
      royals: {
        p1: [C, D, H, S].slice(0, kings).map((suit) => ({ c: card(K, suit), g: false })),
        p2: [],
      },
    });
    expect(kingsOf(s, "p1")).toBe(kings);
    expect(goalOf(s, "p1")).toBe(goal);
  });

  it("glasses eights and queens do not count as kings", () => {
    const s = baseState({
      royals: {
        p1: [
          { c: card(8, C), g: true },
          { c: card(Q, C), g: false },
        ],
        p2: [],
      },
    });
    expect(kingsOf(s, "p1")).toBe(0);
    expect(goalOf(s, "p1")).toBe(21);
  });

  it("playing a king wins immediately if points already meet the lowered goal", () => {
    const s = baseState({
      hands: { p1: [card(K, S)], p2: [] },
      points: { p1: [stack(card(10, H), "p1"), stack(card(4, C), "p1")], p2: [] },
    });
    expect(actRoyal(s, "p1", card(K, S))).toBe(true);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("p1");
  });

  it("reaching your goal with a point card ends the game", () => {
    const s = baseState({
      hands: { p1: [card(10, H)], p2: [] },
      points: { p1: [stack(card(10, S), "p1"), stack(card(1, C), "p1")], p2: [] },
    });
    expect(actPoint(s, "p1", card(10, H))).toBe(true);
    expect(s.phase).toBe("over");
    expect(s.winner).toBe("p1");
    expect(pointsOf(s, "p1")).toBe(21);
  });
});
