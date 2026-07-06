import { cardName, rankOf, type Card } from "./cards";
import { other, type GameState, type PlayerId, type Rng } from "./types";

/** Fisher–Yates shuffle. RNG is injected so callers control randomness —
 *  never call this from inside a React state updater or any code that may
 *  be re-executed for the same user action. */
export function newDeck(rng: Rng = Math.random): Card[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function newGame(
  names: Record<PlayerId, string>,
  dealer: PlayerId,
  rng: Rng = Math.random
): GameState {
  const deck = newDeck(rng);
  const nd = other(dealer);
  const hands: Record<PlayerId, Card[]> = { p1: [], p2: [] };
  hands[dealer] = deck.splice(0, 6);
  hands[nd] = deck.splice(0, 5);
  return {
    phase: names.p2 ? "play" : "waiting",
    turn: nd,
    actor: null,
    pending: null,
    sevenCard: null,
    discardNeed: 0,
    deck,
    scrap: [],
    hands,
    points: { p1: [], p2: [] },
    royals: { p1: [], p2: [] },
    names,
    dealer,
    passes: 0,
    winner: null,
    log: [
      `Cards dealt. ${names[dealer]} is the dealer (6 cards); ${names[nd] || "Player 2"} goes first.`,
    ],
  };
}

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

// ---------- Selectors ----------

export function pointsOf(s: GameState, p: PlayerId): number {
  return s.points[p].reduce((t, st) => t + rankOf(st.c), 0);
}

export function kingsOf(s: GameState, p: PlayerId): number {
  return s.royals[p].filter((r) => !r.g && rankOf(r.c) === 13).length;
}

export const KING_GOALS = [21, 14, 10, 7, 5] as const;

export function goalOf(s: GameState, p: PlayerId): number {
  return KING_GOALS[Math.min(kingsOf(s, p), 4)];
}

export function queensOf(s: GameState, p: PlayerId) {
  return s.royals[p].filter((r) => !r.g && rankOf(r.c) === 12);
}

/** Queens protect all of their owner's OTHER cards — a queen never protects
 *  itself, so targeting the only queen is always legal. */
export function isProtected(s: GameState, ownerP: PlayerId, cardId: Card): boolean {
  return queensOf(s, ownerP).some((q) => q.c !== cardId);
}

export function hasCounterTwo(s: GameState, p: PlayerId): boolean {
  return s.hands[p].some((c) => rankOf(c) === 2);
}

// ---------- Shared internals (used by actions) ----------

export function checkWinAndEndTurn(s: GameState): void {
  for (const p of [s.turn, other(s.turn)]) {
    if (pointsOf(s, p) >= goalOf(s, p)) {
      s.phase = "over";
      s.winner = p;
      s.log.push(`🏆 ${s.names[p]} wins with ${pointsOf(s, p)} points (goal ${goalOf(s, p)})!`);
      return;
    }
  }
  s.turn = other(s.turn);
  s.phase = "play";
  s.actor = null;
  s.sevenCard = null;
}

export function removeFromHand(s: GameState, p: PlayerId, card: Card): void {
  s.hands[p] = s.hands[p].filter((c) => c !== card);
}

/** Validates a card play: normal turn (card must be in hand) or forced seven play. */
export function playGuard(s: GameState, me: PlayerId, card: Card, fromSeven?: boolean): boolean {
  if (fromSeven) return s.phase === "seven" && s.actor === me && s.sevenCard === card;
  return s.phase === "play" && s.turn === me && s.hands[me].includes(card);
}

/** Pops the top jack off a stack and hands control back to the other side.
 *  Returns the removed jack (scrapped only when `jackToScrap`). */
export function revertStackAfterJackRemoved(
  s: GameState,
  p: PlayerId,
  i: number,
  jackToScrap: boolean
): Card {
  const st = s.points[p][i];
  const jack = st.jacks.pop() as Card;
  if (jackToScrap) s.scrap.push(jack);
  s.points[p].splice(i, 1);
  s.points[other(p)].push(st);
  return jack;
}

export function describeTarget(s: GameState, t: { kind: string; p: PlayerId; i: number }): string {
  if (t.kind === "royal") return cardName(s.royals[t.p][t.i].c);
  if (t.kind === "jack") {
    const st = s.points[t.p][t.i];
    return cardName(st.jacks[st.jacks.length - 1]) + ` (on ${cardName(st.c)})`;
  }
  if (t.kind === "point") return cardName(s.points[t.p][t.i].c);
  return "?";
}
