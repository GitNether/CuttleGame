import { cardPower, rankOf, type Card } from "./cards";
import { applyAction, type Action } from "./applyAction";
import { declineCounter, playCounterTwo } from "./actions";
import { jackTargets, nineTargets, scuttleTargets, twoTargets } from "./targets";
import { clone, goalOf, kingsOf, pointsOf, queensOf } from "./state";
import { other, type GameState, type PlayerId, type Rng } from "./types";

// A heuristic single-player opponent. For each legal action it simulates the
// result through the real engine, rolls any immediate follow-up phases forward
// with simple choices, and scores the resulting position — then plays near the
// best (with a little randomness so it isn't perfectly predictable). No deep
// search and no peeking at the hidden hand, but a solid casual opponent.

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
  // My progress — worth far less when the opponent is about to win (points I
  // can't cash in before they win are pointless).
  v += ((myGoal - myNeed) / myGoal) * (oppThreat && myNeed > 0 ? 8 : 40);
  // Opponent progress is bad, weighed heavily once they're threatening.
  v -= ((oppGoal - oppNeed) / oppGoal) * (oppThreat ? 90 : 40);
  if (oppThreat) v -= (11 - oppNeed) * 6;
  v += (myP - oppP) * 1;
  v += (s.hands[me].length - s.hands[opp].length) * 1.5;
  v += (kingsOf(s, me) - kingsOf(s, opp)) * 4;
  v += (queensOf(s, me).length - queensOf(s, opp).length) * 3;
  return v;
}

/** Resolve immediate follow-up phases with simple, reasonable choices so the
 *  evaluation reflects the true effect of a move (e.g. a Four really costing
 *  the opponent two cards). Counters are assumed declined; the forced Seven is
 *  intentionally NOT rolled forward — its value comes from a card we haven't
 *  seen, so we don't let the AI peek at the deck. */
function rollForward(sim: GameState): void {
  let guard = 0;
  while (guard++ < 8 && sim.actor) {
    if (sim.phase === "counter") {
      if (!declineCounter(sim, sim.actor)) break;
    } else if (sim.phase === "scrap_pick") {
      if (!applyAction(sim, chooseScrapPick(sim, sim.actor))) break;
    } else if (sim.phase === "discard") {
      if (!applyAction(sim, chooseDiscard(sim, sim.actor))) break;
    } else {
      break; // play / seven / over — nothing to auto-resolve
    }
  }
}

/** Score an action by simulating and evaluating the resulting position. */
function scoreAction(s: GameState, me: PlayerId, action: Action): number {
  const sim = clone(s);
  if (!applyAction(sim, action)) return -Infinity;
  rollForward(sim);
  return evalState(sim, me);
}

/** Tactical nudges the static eval can't see. */
function moveHeuristics(s: GameState, me: PlayerId, action: Action): number {
  const opp = other(me);
  const threat = isThreatening(s, opp);
  const myNeed = goalOf(s, me) - pointsOf(s, me);

  if (action.type === "draw") {
    // Build a hand when it's thin and nothing urgent is happening.
    return !threat && s.hands[me].length <= 3 && s.deck.length > 0 ? 4 : 0;
  }
  if (!("card" in action)) return 0;
  const r = rankOf(action.card);

  if (action.type === "oneOff") {
    if (r === 7) return threat && myNeed > 0 ? 16 : 5; // draw & play a free card
    if (r === 5) return 2; //  draw two — handy tempo
    if (r === 1) return -14; // hold the Ace for a big board
    if (r === 6) return -9; //  hold the Six for their royals/jacks
    if (r === 2) return -7; //  keep 2s to counter or hit a key royal
    if (r === 9) return -3; //  mild — nines are strong proactively too
  }

  // Keep your single best point card as a finisher/scuttler while the win is
  // still far off — makes the AI less predictable and holds a scuttler back.
  if (action.type === "point" && !threat && myNeed > 10 && r >= 8) {
    const pointRanks = s.hands[me].map((c) => rankOf(c)).filter((x) => x <= 10);
    if (r === Math.max(0, ...pointRanks)) return -6;
  }
  return 0;
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

const PICK_EPSILON = 2.5; // pick randomly among moves within this of the best

/** Pick near the best move — randomly among those within PICK_EPSILON — so the
 *  AI plays well but isn't perfectly predictable. */
function pickBest(
  s: GameState,
  me: PlayerId,
  candidates: Action[],
  rng: Rng,
  withTactics = false
): Action | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((a) => ({
    a,
    sc: scoreAction(s, me, a) + (withTactics ? moveHeuristics(s, me, a) : 0),
  }));
  let bestScore = -Infinity;
  for (const x of scored) bestScore = Math.max(bestScore, x.sc);
  const top = scored.filter((x) => x.sc >= bestScore - PICK_EPSILON);
  return top[Math.floor(rng() * top.length)].a;
}

function choosePlay(s: GameState, me: PlayerId, rng: Rng): Action {
  const candidates: Action[] = [{ type: "draw", by: me }];
  for (const c of s.hands[me]) candidates.push(...cardActions(s, me, c, false));
  return pickBest(s, me, candidates, rng, true) ?? { type: "draw", by: me };
}

function chooseSeven(s: GameState, me: PlayerId, rng: Rng): Action {
  const c = s.sevenCard;
  if (c == null) return { type: "sevenDiscard", by: me };
  const candidates = cardActions(s, me, c, true);
  return pickBest(s, me, candidates, rng) ?? { type: "sevenDiscard", by: me };
}

function chooseCounter(s: GameState, me: PlayerId): Action {
  const twos = s.hands[me].filter((c) => rankOf(c) === 2);
  if (twos.length === 0) return { type: "declineCounter", by: me };

  const simDecline = clone(s);
  declineCounter(simDecline, me);
  rollForward(simDecline);
  const vDecline = evalState(simDecline, me);

  const simCounter = clone(s);
  playCounterTwo(simCounter, me, twos[0]);
  rollForward(simCounter);
  const vCounter = evalState(simCounter, me);

  // Countering spends a 2 — worth it for a real gain, but block readily once
  // the follow-through shows the one-off actually hurts.
  return vCounter > vDecline + 2
    ? { type: "counter", by: me, card: twos[0] }
    : { type: "declineCounter", by: me };
}

function chooseDiscard(s: GameState, me: PlayerId): Action {
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
