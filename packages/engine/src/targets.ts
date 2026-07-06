import { cardPower, type Card } from "./cards";
import { isProtected, queensOf } from "./state";
import { other, type GameState, type PlayerId, type Target } from "./types";

/** Indices of opponent point stacks this card may scuttle (rank, then suit). */
export function scuttleTargets(s: GameState, me: PlayerId, card: Card): number[] {
  const opp = other(me);
  return s.points[opp]
    .map((st, i) => (cardPower(card) > cardPower(st.c) ? i : -1))
    .filter((i) => i >= 0);
}

/** Indices of opponent point stacks a Jack may steal (none while they have a Queen). */
export function jackTargets(s: GameState, me: PlayerId): number[] {
  const opp = other(me);
  return queensOf(s, opp).length > 0 ? [] : s.points[opp].map((_, i) => i);
}

/** Targets for a 2 one-off: royals/glasses and top jacks, any side;
 *  the opponent's side respects Queen protection. */
export function twoTargets(s: GameState, me: PlayerId): Target[] {
  const out: Target[] = [];
  for (const p of ["p1", "p2"] as PlayerId[]) {
    s.royals[p].forEach((r, i) => {
      if (p === me || !isProtected(s, p, r.c)) out.push({ kind: "royal", p, i });
    });
    s.points[p].forEach((st, i) => {
      if (st.jacks.length > 0 && (p === me || !isProtected(s, p, st.jacks[st.jacks.length - 1])))
        out.push({ kind: "jack", p, i });
    });
  }
  return out;
}

/** Targets for a 9 one-off: any permanent — royals, top jacks, point cards. */
export function nineTargets(s: GameState, me: PlayerId): Target[] {
  const out: Target[] = [];
  for (const p of ["p1", "p2"] as PlayerId[]) {
    s.royals[p].forEach((r, i) => {
      if (p === me || !isProtected(s, p, r.c)) out.push({ kind: "royal", p, i });
    });
    s.points[p].forEach((st, i) => {
      if (st.jacks.length > 0 && (p === me || !isProtected(s, p, st.jacks[st.jacks.length - 1])))
        out.push({ kind: "jack", p, i });
      if (p === me || !isProtected(s, p, st.c)) out.push({ kind: "point", p, i });
    });
  }
  return out;
}
