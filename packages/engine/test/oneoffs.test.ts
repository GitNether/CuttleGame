import { describe, expect, it } from "vitest";
import {
  actDiscardDone,
  actDraw,
  actOneOff,
  actPoint,
  actRoyal,
  actScrapPick,
  actSevenDiscard,
  declineCounter,
  playCounterTwo,
} from "../src";
import { A, C, D, H, J, K, Q, S, baseState, card, stack } from "./helpers";

describe("Ace one-off", () => {
  it("scraps every point card on both sides, including attached jacks", () => {
    const s = baseState({
      hands: { p1: [card(A, C)], p2: [] },
      points: {
        p1: [stack(card(5, D), "p1")],
        p2: [stack(card(10, H), "p1", [card(J, C)])],
      },
    });
    actOneOff(s, "p1", card(A, C), null);
    expect(s.points.p1).toHaveLength(0);
    expect(s.points.p2).toHaveLength(0);
    expect(s.scrap).toEqual(
      expect.arrayContaining([card(A, C), card(5, D), card(10, H), card(J, C)])
    );
  });
});

describe("Three one-off (scrap retrieval)", () => {
  it("lets the player take one card; the three lands in the scrap afterwards", () => {
    const wanted = card(K, S);
    const s = baseState({
      hands: { p1: [card(3, C)], p2: [] },
      scrap: [wanted, card(4, D)],
    });
    actOneOff(s, "p1", card(3, C), null);
    expect(s.phase).toBe("scrap_pick");
    expect(s.actor).toBe("p1");
    expect(actScrapPick(s, "p1", wanted)).toBe(true);
    expect(s.hands.p1).toContain(wanted);
    expect(s.scrap).toEqual([card(4, D), card(3, C)]);
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p2");
  });

  it("does nothing when the scrap is empty", () => {
    const s = baseState({ hands: { p1: [card(3, C)], p2: [] } });
    actOneOff(s, "p1", card(3, C), null);
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p2");
    expect(s.scrap).toEqual([card(3, C)]);
  });
});

describe("Four one-off (forced discard)", () => {
  it("opponent chooses and discards two cards", () => {
    const s = baseState({
      hands: { p1: [card(4, C)], p2: [card(9, D), card(8, H), card(2, S)] },
    });
    actOneOff(s, "p1", card(4, C), null);
    // p2 holds a 2 → counter window first
    expect(s.phase).toBe("counter");
    playCounterTwo(s, "p2", card(2, S));
    // cancelled — hand intact minus the spent 2
    expect(s.hands.p2).toEqual([card(9, D), card(8, H)]);

    const s2 = baseState({
      hands: { p1: [card(4, C)], p2: [card(9, D), card(8, H), card(7, S)] },
    });
    actOneOff(s2, "p1", card(4, C), null);
    expect(s2.phase).toBe("discard");
    expect(s2.actor).toBe("p2");
    expect(s2.discardNeed).toBe(2);
    expect(actDiscardDone(s2, "p2", [card(9, D)])).toBe(false); // must be exactly 2
    expect(actDiscardDone(s2, "p2", [card(9, D), card(9, D)])).toBe(false); // no dupes
    expect(actDiscardDone(s2, "p2", [card(9, D), card(7, S)])).toBe(true);
    expect(s2.hands.p2).toEqual([card(8, H)]);
    expect(s2.turn).toBe("p2");
  });

  it("clamps to the opponent's hand size", () => {
    const s = baseState({ hands: { p1: [card(4, C)], p2: [card(9, D)] } });
    actOneOff(s, "p1", card(4, C), null);
    expect(s.discardNeed).toBe(1);
    expect(actDiscardDone(s, "p2", [card(9, D)])).toBe(true);
    expect(s.hands.p2).toHaveLength(0);
  });

  it("resolves as a no-op when the opponent's hand is empty", () => {
    const s = baseState({ hands: { p1: [card(4, C)], p2: [] } });
    actOneOff(s, "p1", card(4, C), null);
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p2");
  });
});

describe("Five one-off", () => {
  it("draws two (or as many as remain)", () => {
    const s = baseState({
      hands: { p1: [card(5, C)], p2: [] },
      deck: [card(9, D), card(8, H), card(7, S)],
    });
    actOneOff(s, "p1", card(5, C), null);
    expect(s.hands.p1).toEqual([card(9, D), card(8, H)]);
    expect(s.deck).toEqual([card(7, S)]);

    const s2 = baseState({ hands: { p1: [card(5, C)], p2: [] }, deck: [card(9, D)] });
    actOneOff(s2, "p1", card(5, C), null);
    expect(s2.hands.p1).toEqual([card(9, D)]);
  });
});

describe("Seven one-off (forced play, incl. nesting)", () => {
  it("reveals the top card which must then be played — e.g. for points", () => {
    const revealed = card(10, D);
    const s = baseState({
      hands: { p1: [card(7, C)], p2: [] },
      deck: [revealed, card(3, S)],
    });
    actOneOff(s, "p1", card(7, C), null);
    expect(s.phase).toBe("seven");
    expect(s.actor).toBe("p1");
    expect(s.sevenCard).toBe(revealed);
    // the revealed card is NOT in hand — only the fromSeven path may play it
    expect(actPoint(s, "p1", revealed)).toBe(false);
    expect(actPoint(s, "p1", revealed, true)).toBe(true);
    expect(s.points.p1.map((st) => st.c)).toEqual([revealed]);
    expect(s.sevenCard).toBeNull();
    expect(s.turn).toBe("p2");
  });

  it("nests one-offs: a revealed 5 can be played as a one-off and countered", () => {
    const revealed = card(5, D);
    const s = baseState({
      hands: { p1: [card(7, C)], p2: [card(2, H)] },
      deck: [revealed, card(9, S), card(8, S)],
    });
    actOneOff(s, "p1", card(7, C), null); // p2's 2 could counter the 7 — decline path:
    expect(s.phase).toBe("counter");
    expect(playCounterTwo(s, "p2", card(2, H))).toBe(true); // actually counter it
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p2"); // 7 cancelled, turn passed

    // now without the counter:
    const s2 = baseState({
      hands: { p1: [card(7, C)], p2: [card(2, H)] },
      deck: [revealed, card(9, S), card(8, S)],
    });
    actOneOff(s2, "p1", card(7, C), null);
    // p2 declines the 7…
    expect(s2.phase).toBe("counter");
    expect(s2.actor).toBe("p2");
    expect(declineCounter(s2, "p2")).toBe(true);
    expect(s2.phase).toBe("seven");
    // …p1 plays the revealed 5 as a nested one-off; p2 can counter THAT too
    expect(actOneOff(s2, "p1", revealed, null, true)).toBe(true);
    expect(s2.phase).toBe("counter");
    playCounterTwo(s2, "p2", card(2, H));
    // nested 5 cancelled; turn over, no cards drawn
    expect(s2.phase).toBe("play");
    expect(s2.turn).toBe("p2");
    expect(s2.hands.p1).toHaveLength(0);
    expect(s2.scrap).toEqual(expect.arrayContaining([card(7, C), revealed, card(2, H)]));
  });

  it("a revealed royal can be played as a royal", () => {
    const revealed = card(Q, S);
    const s = baseState({ hands: { p1: [card(7, C)], p2: [] }, deck: [revealed] });
    actOneOff(s, "p1", card(7, C), null);
    expect(actRoyal(s, "p1", revealed, false, true)).toBe(true);
    expect(s.royals.p1[0]).toMatchObject({ c: revealed, g: false });
  });

  it("an unplayable revealed card is discarded", () => {
    // Revealed jack with no opponent points and nothing else legal
    const revealed = card(J, S);
    const s = baseState({ hands: { p1: [card(7, C)], p2: [] }, deck: [revealed] });
    actOneOff(s, "p1", card(7, C), null);
    expect(s.phase).toBe("seven");
    expect(actSevenDiscard(s, "p1")).toBe(true);
    expect(s.scrap).toContain(revealed);
    expect(s.turn).toBe("p2");
  });

  it("does nothing on an empty deck", () => {
    const s = baseState({ hands: { p1: [card(7, C)], p2: [] }, deck: [] });
    actOneOff(s, "p1", card(7, C), null);
    expect(s.phase).toBe("play");
    expect(s.turn).toBe("p2");
  });
});

describe("Nine one-off — HOUSE RULE: target goes on top of the draw pile", () => {
  it("a bounced royal becomes the next card drawn", () => {
    const king = card(K, H);
    const s = baseState({
      hands: { p1: [card(9, C)], p2: [] },
      deck: [card(3, S)],
      royals: { p1: [], p2: [{ c: king, g: false }] },
    });
    actOneOff(s, "p1", card(9, C), { kind: "royal", p: "p2", i: 0 });
    expect(s.royals.p2).toHaveLength(0);
    expect(s.deck[0]).toBe(king); // on TOP of the pile, not in hand
    expect(s.hands.p2).not.toContain(king);
    // opponent draws it right back
    expect(actDraw(s, "p2")).toBe(true);
    expect(s.hands.p2).toContain(king);
  });

  it("a bounced point card scraps its jacks and tops the deck", () => {
    const ten = card(10, H);
    const j = card(J, C);
    const s = baseState({
      hands: { p1: [card(9, C)], p2: [] },
      deck: [card(3, S)],
      points: { p1: [], p2: [stack(ten, "p2", [j])] },
    });
    actOneOff(s, "p1", card(9, C), { kind: "point", p: "p2", i: 0 });
    expect(s.deck[0]).toBe(ten);
    expect(s.scrap).toContain(j);
    expect(s.points.p2).toHaveLength(0);
  });

  it("a bounced top jack returns control and tops the deck", () => {
    const ten = card(10, H);
    const j = card(J, C);
    const s = baseState({
      hands: { p1: [card(9, C)], p2: [] },
      deck: [],
      points: { p1: [], p2: [stack(ten, "p1", [j])] }, // p2 stole p1's ten
    });
    actOneOff(s, "p1", card(9, C), { kind: "jack", p: "p2", i: 0 });
    expect(s.deck[0]).toBe(j);
    expect(s.points.p1[0]).toMatchObject({ c: ten, jacks: [], base: "p1" });
    expect(s.scrap).not.toContain(j);
  });
});
