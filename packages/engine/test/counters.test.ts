import { describe, expect, it } from "vitest";
import { actOneOff, declineCounter, playCounterTwo } from "../src";
import { A, C, D, H, Q, S, baseState, card, stack } from "./helpers";

// An Ace one-off from p1 against p2's point cards, with varying counter chains.
function aceSetup(p1Extra: number[] = [], p2Twos: number[] = []) {
  return baseState({
    hands: { p1: [card(A, C), ...p1Extra], p2: [...p2Twos] },
    points: { p1: [], p2: [stack(card(10, H), "p2")] },
  });
}

describe("counter chains (LIFO 2-vs-2)", () => {
  it("0 counters: responder without a 2 never gets a counter window", () => {
    const s = aceSetup([], [card(9, D)]);
    expect(actOneOff(s, "p1", card(A, C), null)).toBe(true);
    // resolved immediately
    expect(s.phase).toBe("play");
    expect(s.points.p2).toHaveLength(0);
    expect(s.scrap).toEqual(expect.arrayContaining([card(A, C), card(10, H)]));
    expect(s.turn).toBe("p2");
  });

  it("1 counter: one-off is cancelled, both cards scrapped", () => {
    const s = aceSetup([], [card(2, C)]);
    actOneOff(s, "p1", card(A, C), null);
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p2");
    expect(playCounterTwo(s, "p2", card(2, C))).toBe(true);
    // p1 has no 2 to counter back → auto-resolves as cancelled
    expect(s.phase).toBe("play");
    expect(s.points.p2).toHaveLength(1); // survived
    expect(s.scrap).toEqual(expect.arrayContaining([card(A, C), card(2, C)]));
    expect(s.turn).toBe("p2"); // playing the one-off consumed p1's turn
  });

  it("2 counters: counter-the-counter, one-off resolves", () => {
    const s = aceSetup([card(2, D)], [card(2, C)]);
    actOneOff(s, "p1", card(A, C), null);
    playCounterTwo(s, "p2", card(2, C));
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p1");
    expect(playCounterTwo(s, "p1", card(2, D))).toBe(true);
    expect(s.phase).toBe("play");
    expect(s.points.p2).toHaveLength(0); // ace resolved after all
    expect(s.scrap).toEqual(
      expect.arrayContaining([card(A, C), card(2, C), card(2, D), card(10, H)])
    );
  });

  it("3 counters: cancelled again", () => {
    const s = aceSetup([card(2, D)], [card(2, C), card(2, H)]);
    actOneOff(s, "p1", card(A, C), null);
    playCounterTwo(s, "p2", card(2, C));
    playCounterTwo(s, "p1", card(2, D));
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p2");
    playCounterTwo(s, "p2", card(2, H));
    expect(s.phase).toBe("play");
    expect(s.points.p2).toHaveLength(1); // survived: 3 counters = cancelled
    expect(s.scrap).toHaveLength(4); // ace + three 2s
  });

  it("declining lets the one-off resolve", () => {
    const s = aceSetup([], [card(2, C)]);
    actOneOff(s, "p1", card(A, C), null);
    expect(declineCounter(s, "p2")).toBe(true);
    expect(s.points.p2).toHaveLength(0);
    expect(s.hands.p2).toEqual([card(2, C)]); // kept the 2
  });

  it("only the current responder may counter, and only with a 2", () => {
    const s = aceSetup([card(2, D)], [card(2, C), card(9, S)]);
    actOneOff(s, "p1", card(A, C), null);
    expect(playCounterTwo(s, "p1", card(2, D))).toBe(false); // not p1's window
    expect(playCounterTwo(s, "p2", card(9, S))).toBe(false); // not a 2
    expect(declineCounter(s, "p1")).toBe(false);
    expect(playCounterTwo(s, "p2", card(2, C))).toBe(true);
  });
});

describe("Queens do NOT block counters — a 2 can always counter a one-off", () => {
  it("responder with a 2 can still counter when the one-off player has a Queen", () => {
    const s = aceSetup([], [card(2, C)]);
    s.royals.p1 = [{ c: card(Q, H), g: false }];
    actOneOff(s, "p1", card(A, C), null);
    // the counter window opens despite p1's queen
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p2");
    expect(playCounterTwo(s, "p2", card(2, C))).toBe(true);
    // ace cancelled — p2's points survive
    expect(s.points.p2).toHaveLength(1);
    expect(s.scrap).toEqual(expect.arrayContaining([card(A, C), card(2, C)]));
  });

  it("a Glasses eight is not a Queen and blocks nothing either", () => {
    const s = aceSetup([], [card(2, C)]);
    s.royals.p1 = [{ c: card(8, H), g: true }];
    actOneOff(s, "p1", card(A, C), null);
    expect(s.phase).toBe("counter");
  });

  it("a Queen does not stop a re-counter in the chain", () => {
    // p2 has a queen; p1 plays a one-off; p2 counters; p1 re-counters freely.
    const s = aceSetup([card(2, D)], [card(2, C)]);
    s.royals.p2 = [{ c: card(Q, S), g: false }];
    actOneOff(s, "p1", card(A, C), null);
    expect(s.phase).toBe("counter");
    playCounterTwo(s, "p2", card(2, C));
    // p1's re-counter window is now open (previously it was wrongly denied)
    expect(s.phase).toBe("counter");
    expect(s.actor).toBe("p1");
    expect(playCounterTwo(s, "p1", card(2, D))).toBe(true);
    // two counters → the ace resolves after all
    expect(s.phase).toBe("play");
    expect(s.points.p2).toHaveLength(0);
  });
});
