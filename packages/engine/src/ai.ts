import { cardPower, rankOf, type Card } from "./cards";
import { applyAction, type Action } from "./applyAction";
import { declineCounter, playCounterTwo } from "./actions";
import { jackTargets, nineTargets, scuttleTargets, twoTargets } from "./targets";
import { clone, goalOf, kingsOf, pointsOf, queensOf } from "./state";
import { other, type GameState, type PlayerId, type Rng } from "./types";

// A heuristic single-player opponent. It's a greedy 1-ply evaluator: for each
// legal action it simulates the result through the real engine and scores the
// resulting position, then plays the best. Not a perfect player — it doesn't
// search ahead or reason about the hidden hand — but a solid casual opponent.

/** Is `opp` one point card away from winning (i.e. threatening lethal)? */
function isThreatening(s: GameState, opp: PlayerId): boolean {
  const need = goalOf(s, opp) - pointsOf(s, opp);
  return need > 0 && need <= 10 && s.hands[opp].length > 0;
}

/** Static evaluation of a position from `me`'s perspective (higher = better). */
function evalState(s: GameState, me: PlayerId): number {
  const opp = other(me);
  if (s.phase === "over") {
    if (s.winner === me) return 100000;
    if (s.winner === opp) return -100000;
    return 0; // draw
  }
  const myP = pointsOf(s, me);
  const oppP = pointsOf(s, opp);
  const myGoal = goalOf(s, me);
  const oppGoal = goalOf(s, opp);
  const myNeed = Math.max(0, myGoal - myP);
  const oppNeed = Math.max(0, oppGoal - oppP);
  const oppThreat = isThreatening(s, opp);

  let v = 0;
  // My progress toward the goal — but worth far less when the opponent is
  // about to win, because points I'll never get to cash in are pointless.
  v += ((myGoal - myNeed) / myGoal) * (oppThreat && myNeed > 0 ? 8 : 40);
  // Opponent progress is bad, and weighed heavily once they're threatening —
  // this makes disruption (scuttle, Ace, raising their goal) the priority.
  v -= ((oppGoal - oppNeed) / oppGoal) * (oppThreat ? 90 : 40);
  if (oppThreat) v -= (11 - oppNeed) * 6; // the closer to lethal, the worse
  v += (myP - oppP) * 1; // small tie-breaker on raw board points
  v += (s.hands[me].length - s.hands[opp].length) * 1.5; // card advantage
  v += (kingsOf(s, me) - kingsOf(s, opp)) * 4; // kings lower the goal
  v += (queensOf(s, me).length - queensOf(s, opp).length) * 3; // protection
  return v;
}

/** Extra tactical nudges the static eval can't see. */
function tacticalBonus(s: GameState, me: PlayerId, action: Action): number {
  if (!("card" in action)) return 0;
  const opp = other(me);
  const myNeed = goalOf(s, me) - pointsOf(s, me);
  if (!isThreatening(s, opp) || myNeed <= 0) return 0;
  // Facing likely defeat: gamble a Seven (draw & play the top card) to dig for
  // a disruptive card, rather than making a dead point play that can't save us.
  if (action.type === "oneOff" && rankOf(action.card) === 7) return 12;
  return 0;
}

/** Score an action by simulating it and evaluating the result. One-offs that
 *  land in a counter window are assumed to resolve (the opponent declines). */
function scoreAction(s: GameState, me: PlayerId, action: Action): number {
  const sim = clone(s);
  if (!applyAction(sim, action)) return -Infinity;
  let guard = 0;
  while (sim.phase === "counter" && sim.pending && sim.actor === other(me) && guard++ < 4) {
    if (!declineCounter(sim, other(me))) break;
  }
  return evalState(sim, me);
}

const ONE_OFF_NO_TARGET = new Set([1, 3, 4, 5, 6, 7]);

/** All legal plays for `card` on `me`'s turn (or forced from a Seven). */
function cardActions(s: GameState, me: PlayerId, card: Card, fromSeven: boolean): Action[] {
  const out: Action[] = [];
  const r = rankOf(card);
  const opp = other(me);
  if (r <= 10) out.push({ type: "point", by: me, card, fromSeven });
  for (const idx of scuttleTargets(s, me, card))
    out.push({ type: "scuttle", by: me, card, targetIdx: idx, fromSeven });
  if (r === 11)
    for (const idx of jackTargets(s, me)) out.push({ type: "jack", by: me, card, targetIdx: idx, fromSeven });
  if (r === 12 || r === 13) out.push({ type: "royal", by: me, card, fromSeven });
  if (r === 8) out.push({ type: "royal", by: me, card, glasses: true, fromSeven });
  if (ONE_OFF_NO_TARGET.has(r)) {
    const blocked =
      (r === 3 && s.scrap.length === 0) ||
      (r === 7 && s.deck.length === 0) ||
      (r === 4 && s.hands[opp].length === 0);
    if (!blocked) out.push({ type: "oneOff", by: me, card, target: null, fromSeven });
  }
  if (r === 2) for (const t of twoTargets(s, me)) out.push({ type: "oneOff", by: me, card, target: t, fromSeven });
  if (r === 9) for (const t of nineTargets(s, me)) out.push({ type: "oneOff", by: me, card, target: t, fromSeven });
  return out;
}

function bestOf(
  s: GameState,
  me: PlayerId,
  candidates: Action[],
  rng: Rng,
  withTactics = false
): Action | null {
  let best: Action | null = null;
  let bestScore = -Infinity;
  for (const a of candidates) {
    const sc = scoreAction(s, me, a) + (withTactics ? tacticalBonus(s, me, a) : 0);
    if (sc > bestScore || (sc === bestScore && rng() < 0.5)) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}

function choosePlay(s: GameState, me: PlayerId, rng: Rng): Action {
  const candidates: Action[] = [{ type: "draw", by: me }];
  for (const c of s.hands[me]) candidates.push(...cardActions(s, me, c, false));
  return bestOf(s, me, candidates, rng, true) ?? { type: "draw", by: me };
}

function chooseSeven(s: GameState, me: PlayerId, rng: Rng): Action {
  const c = s.sevenCard;
  if (c == null) return { type: "sevenDiscard", by: me };
  const candidates = cardActions(s, me, c, true);
  return bestOf(s, me, candidates, rng) ?? { type: "sevenDiscard", by: me };
}

function chooseCounter(s: GameState, me: PlayerId): Action {
  const twos = s.hands[me].filter((c) => rankOf(c) === 2);
  if (twos.length === 0) return { type: "declineCounter", by: me };

  const simDecline = clone(s);
  declineCounter(simDecline, me);
  const vDecline = evalState(simDecline, me);

  const simCounter = clone(s);
  playCounterTwo(simCounter, me, twos[0]);
  let guard = 0;
  while (simCounter.phase === "counter" && simCounter.actor === other(me) && guard++ < 4) {
    if (!declineCounter(simCounter, other(me))) break;
  }
  const vCounter = evalState(simCounter, me);

  // Countering spends a 2 (worth keeping) — only do it for a real gain.
  return vCounter > vDecline + 3
    ? { type: "counter", by: me, card: twos[0] }
    : { type: "declineCounter", by: me };
}

function chooseDiscard(s: GameState, me: PlayerId): Action {
  // Keep the most useful cards; dump the rest.
  const keep = (c: Card) => {
    const r = rankOf(c);
    if (r === 2) return 100; // counters
    if (r === 13) return 90; // king
    if (r === 12) return 80; // queen
    if (r === 11) return 70; // jack
    if (r === 1) return 60; // ace one-off
    return r;
  };
  const cards = [...s.hands[me]].sort((a, b) => keep(a) - keep(b)).slice(0, s.discardNeed);
  return { type: "discard", by: me, cards };
}

function chooseScrapPick(s: GameState, me: PlayerId): Action {
  const value = (c: Card) => {
    const r = rankOf(c);
    if (r === 2) return 1000;
    if (r === 13) return 900;
    if (r <= 10) return 500 + cardPower(c);
    return 400;
  };
  let best = s.scrap[0];
  let bv = -Infinity;
  for (const c of s.scrap) {
    const v = value(c);
    if (v > bv) {
      bv = v;
      best = c;
    }
  }
  return { type: "scrapPick", by: me, card: best };
}

/** Pick the action the AI should take right now, or null if it isn't the AI's
 *  move. Always returns a legal action when it is the AI's move. */
export function chooseAction(s: GameState, me: PlayerId, rng: Rng = Math.random): Action | null {
  if (s.phase === "counter" && s.actor === me) return chooseCounter(s, me);
  if (s.phase === "discard" && s.actor === me) return chooseDiscard(s, me);
  if (s.phase === "scrap_pick" && s.actor === me) return chooseScrapPick(s, me);
  if (s.phase === "seven" && s.actor === me) return chooseSeven(s, me, rng);
  if (s.phase === "play" && s.turn === me) return choosePlay(s, me, rng);
  return null;
}
