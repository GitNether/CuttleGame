import { cardName, rankOf, cardPower, type Card } from "./cards";
import {
  checkWinAndEndTurn,
  describeTarget,
  goalOf,
  hasCounterTwo,
  newGame,
  playGuard,
  pointsOf,
  queensOf,
  removeFromHand,
  revertStackAfterJackRemoved,
} from "./state";
import { other, type GameState, type PendingOneOff, type PlayerId, type Rng, type Target } from "./types";

// Every action validates phase / turn / card-existence before mutating and
// returns false when the guard refuses — this is what makes double-taps and
// taps racing an incoming sync harmless. All functions mutate `s` in place;
// callers are responsible for cloning (see applyAction / the sync layer).

export function actDraw(s: GameState, me: PlayerId): boolean {
  if (s.phase !== "play" || s.turn !== me) return false;
  if (s.deck.length === 0) {
    s.passes += 1;
    s.log.push(`${s.names[me]} passes (deck is empty). (${s.passes}/3)`);
    if (s.passes >= 3) {
      s.phase = "over";
      s.winner = "draw";
      s.log.push("Three passes in a row — the game is a draw.");
      return true;
    }
    s.turn = other(s.turn);
    return true;
  }
  s.passes = 0;
  s.hands[me].push(s.deck.shift() as Card);
  s.log.push(`${s.names[me]} draws a card.`);
  checkWinAndEndTurn(s);
  return true;
}

export function actPoint(s: GameState, me: PlayerId, card: Card, fromSeven?: boolean): boolean {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (rankOf(card) > 10) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.points[me].push({ c: card, jacks: [], base: me });
  s.passes = 0;
  s.log.push(`${s.names[me]} plays ${cardName(card)} for points.`);
  checkWinAndEndTurn(s);
  return true;
}

export function actScuttle(
  s: GameState,
  me: PlayerId,
  card: Card,
  targetIdx: number,
  fromSeven?: boolean
): boolean {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (rankOf(card) > 10) return false;
  const opp = other(me);
  const st = s.points[opp][targetIdx];
  if (!st || cardPower(card) <= cardPower(st.c)) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.scrap.push(card, st.c, ...st.jacks);
  s.points[opp].splice(targetIdx, 1);
  s.passes = 0;
  s.log.push(`${s.names[me]} scuttles ${cardName(st.c)} with ${cardName(card)}.`);
  checkWinAndEndTurn(s);
  return true;
}

export function actRoyal(
  s: GameState,
  me: PlayerId,
  card: Card,
  glasses?: boolean,
  fromSeven?: boolean
): boolean {
  if (!playGuard(s, me, card, fromSeven)) return false;
  const r = rankOf(card);
  if (glasses ? r !== 8 : r !== 12 && r !== 13) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.royals[me].push({ c: card, g: !!glasses });
  s.passes = 0;
  s.log.push(
    glasses
      ? `${s.names[me]} plays ${cardName(card)} as GLASSES — ${s.names[other(me)]}'s hand is revealed!`
      : `${s.names[me]} plays ${cardName(card)} as a Royal.`
  );
  checkWinAndEndTurn(s);
  return true;
}

export function actJack(
  s: GameState,
  me: PlayerId,
  card: Card,
  targetIdx: number,
  fromSeven?: boolean
): boolean {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (rankOf(card) !== 11) return false;
  if (!s.points[other(me)][targetIdx] || queensOf(s, other(me)).length > 0) return false;
  const opp = other(me);
  const st = s.points[opp][targetIdx];
  if (!fromSeven) removeFromHand(s, me, card);
  st.jacks.push(card);
  s.points[opp].splice(targetIdx, 1);
  s.points[me].push(st);
  s.passes = 0;
  s.log.push(`${s.names[me]} plays ${cardName(card)} on ${cardName(st.c)} and steals it!`);
  checkWinAndEndTurn(s);
  return true;
}

const ONE_OFF_RANKS = new Set([1, 2, 3, 4, 5, 6, 7, 9]);

export function actOneOff(
  s: GameState,
  me: PlayerId,
  card: Card,
  target?: Target | null,
  fromSeven?: boolean
): boolean {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (!ONE_OFF_RANKS.has(rankOf(card))) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.passes = 0;
  s.pending = { c: card, by: me, target: target || null, counters: [], fromSeven: !!fromSeven };
  s.log.push(
    `${s.names[me]} plays ${cardName(card)} as a one-off${
      target ? ` targeting ${describeTarget(s, target)}` : ""
    }.`
  );
  advanceCounter(s);
  return true;
}

/** After a one-off or a counter: hand the response to the other side, or
 *  resolve immediately when they hold no 2 — or when the last player in the
 *  chain has a Queen (Queens protect their owner's one-offs "in suspension"). */
function advanceCounter(s: GameState): void {
  const pd = s.pending as PendingOneOff;
  const lastBy = pd.counters.length ? pd.counters[pd.counters.length - 1].by : pd.by;
  const responder = other(lastBy);
  if (hasCounterTwo(s, responder) && queensOf(s, lastBy).length === 0) {
    s.phase = "counter";
    s.actor = responder;
  } else {
    resolvePending(s);
  }
}

export function playCounterTwo(s: GameState, me: PlayerId, twoCard: Card): boolean {
  if (s.phase !== "counter" || s.actor !== me || !s.pending || !s.hands[me].includes(twoCard))
    return false;
  if (rankOf(twoCard) !== 2) return false;
  removeFromHand(s, me, twoCard);
  s.pending.counters.push({ c: twoCard, by: me });
  s.log.push(`${s.names[me]} counters with ${cardName(twoCard)}!`);
  advanceCounter(s);
  return true;
}

export function declineCounter(s: GameState, me: PlayerId): boolean {
  if (s.phase !== "counter" || s.actor !== me || !s.pending) return false;
  s.log.push(`${s.names[me]} lets it resolve.`);
  resolvePending(s);
  return true;
}

function resolvePending(s: GameState): void {
  const pd = s.pending as PendingOneOff;
  s.pending = null;
  s.phase = "play";
  s.actor = null;
  for (const ct of pd.counters) s.scrap.push(ct.c);
  const cancelled = pd.counters.length % 2 === 1;
  if (cancelled) {
    s.scrap.push(pd.c);
    s.log.push(`The ${cardName(pd.c)} one-off is countered and scrapped — nothing happens.`);
    checkWinAndEndTurn(s);
    return;
  }
  applyOneOff(s, pd);
}

function applyOneOff(s: GameState, pd: PendingOneOff): void {
  const me = pd.by,
    opp = other(me),
    r = rankOf(pd.c);
  const finish = () => {
    s.scrap.push(pd.c);
    checkWinAndEndTurn(s);
  };

  if (r === 1) {
    for (const p of ["p1", "p2"] as PlayerId[]) {
      for (const st of s.points[p]) s.scrap.push(st.c, ...st.jacks);
      s.points[p] = [];
    }
    s.log.push("💥 Ace: all point cards are scrapped!");
    finish();
  } else if (r === 2) {
    const t = pd.target;
    if (t && t.kind === "royal" && s.royals[t.p][t.i]) {
      const rc = s.royals[t.p].splice(t.i, 1)[0];
      s.scrap.push(rc.c);
      s.log.push(`${cardName(rc.c)} is scrapped.`);
    } else if (t && t.kind === "jack" && s.points[t.p][t.i]) {
      const st = s.points[t.p][t.i];
      s.log.push(
        `${cardName(st.jacks[st.jacks.length - 1])} is scrapped — ${cardName(st.c)} switches back.`
      );
      revertStackAfterJackRemoved(s, t.p, t.i, true);
    }
    finish();
  } else if (r === 3) {
    if (s.scrap.length === 0) {
      s.log.push("The scrap pile is empty — nothing happens.");
      finish();
      return;
    }
    s.phase = "scrap_pick";
    s.actor = me;
    s.pendingCard = pd.c;
    s.pendingFromSeven = pd.fromSeven;
  } else if (r === 4) {
    s.scrap.push(pd.c);
    const need = Math.min(2, s.hands[opp].length);
    if (need === 0) {
      s.log.push(`${s.names[opp]} has no cards to discard.`);
      checkWinAndEndTurn(s);
      return;
    }
    s.phase = "discard";
    s.actor = opp;
    s.discardNeed = need;
    s.pendingFromSeven = pd.fromSeven;
    s.log.push(`${s.names[opp]} must discard ${need} card${need > 1 ? "s" : ""}.`);
  } else if (r === 5) {
    const n = Math.min(2, s.deck.length);
    for (let i = 0; i < n; i++) s.hands[me].push(s.deck.shift() as Card);
    s.log.push(`${s.names[me]} draws ${n} card${n === 1 ? "" : "s"}.`);
    finish();
  } else if (r === 6) {
    for (const p of ["p1", "p2"] as PlayerId[]) {
      for (const rc of s.royals[p]) s.scrap.push(rc.c);
      s.royals[p] = [];
    }
    for (const p of ["p1", "p2"] as PlayerId[]) {
      const moved: typeof s.points.p1 = [];
      s.points[p] = s.points[p].filter((st) => {
        for (const j of st.jacks) s.scrap.push(j);
        st.jacks = [];
        if (st.base !== p) {
          moved.push(st);
          return false;
        }
        return true;
      });
      for (const st of moved) s.points[st.base].push(st);
    }
    s.log.push("🌪 Six: all Royals, Glasses and Jacks are scrapped. Stolen cards return home.");
    finish();
  } else if (r === 7) {
    s.scrap.push(pd.c);
    if (s.deck.length === 0) {
      s.log.push("The deck is empty — nothing happens.");
      checkWinAndEndTurn(s);
      return;
    }
    s.sevenCard = s.deck.shift() as Card;
    s.phase = "seven";
    s.actor = me;
    s.log.push(`${s.names[me]} reveals ${cardName(s.sevenCard)} from the deck and must play it.`);
  } else if (r === 9) {
    // House rule: the bounced permanent goes on TOP of the draw pile,
    // not back into its controller's hand.
    const t = pd.target;
    if (t && t.kind === "royal" && s.royals[t.p][t.i]) {
      const rc = s.royals[t.p].splice(t.i, 1)[0];
      s.deck.unshift(rc.c);
      s.log.push(`${cardName(rc.c)} is placed on top of the draw pile.`);
    } else if (t && t.kind === "jack" && s.points[t.p][t.i]) {
      const st = s.points[t.p][t.i];
      const jc = st.jacks[st.jacks.length - 1];
      revertStackAfterJackRemoved(s, t.p, t.i, false);
      s.deck.unshift(jc);
      s.log.push(
        `${cardName(jc)} is placed on top of the draw pile — ${cardName(st.c)} switches back.`
      );
    } else if (t && t.kind === "point" && s.points[t.p][t.i]) {
      const st = s.points[t.p].splice(t.i, 1)[0];
      for (const j of st.jacks) s.scrap.push(j);
      s.deck.unshift(st.c);
      s.log.push(`${cardName(st.c)} is placed on top of the draw pile.`);
    }
    finish();
  } else {
    finish();
  }
}

export function actScrapPick(s: GameState, me: PlayerId, card: Card): boolean {
  if (s.phase !== "scrap_pick" || s.actor !== me || !s.scrap.includes(card)) return false;
  s.scrap = s.scrap.filter((c) => c !== card);
  s.hands[me].push(card);
  s.scrap.push(s.pendingCard as Card);
  delete s.pendingCard;
  s.log.push(`${s.names[me]} takes ${cardName(card)} from the scrap pile.`);
  delete s.pendingFromSeven;
  s.phase = "play";
  checkWinAndEndTurn(s);
  return true;
}

export function actDiscardDone(s: GameState, me: PlayerId, cards: Card[]): boolean {
  if (
    s.phase !== "discard" ||
    s.actor !== me ||
    cards.length !== s.discardNeed ||
    !cards.every((c) => s.hands[me].includes(c))
  )
    return false;
  if (new Set(cards).size !== cards.length) return false;
  for (const c of cards) {
    removeFromHand(s, me, c);
    s.scrap.push(c);
  }
  s.log.push(`${s.names[me]} discards ${cards.map(cardName).join(" and ")}.`);
  s.discardNeed = 0;
  delete s.pendingFromSeven;
  s.phase = "play";
  checkWinAndEndTurn(s);
  return true;
}

export function actSevenDiscard(s: GameState, me: PlayerId): boolean {
  if (s.phase !== "seven" || s.actor !== me || s.sevenCard == null) return false;
  s.scrap.push(s.sevenCard);
  s.log.push(`${cardName(s.sevenCard)} cannot be played and is discarded.`);
  s.sevenCard = null;
  checkWinAndEndTurn(s);
  return true;
}

/** Rematch: only the winner (or p1 after a draw) may start it; the dealer
 *  alternates. RNG must be supplied by the caller so the shuffle happens
 *  exactly once per confirmed commit. */
export function actRematch(s: GameState, me: PlayerId, rng: Rng = Math.random): boolean {
  if (s.phase !== "over") return false;
  if ((s.winner === "draw" ? "p1" : s.winner) !== me) return false;
  const ng = newGame(s.names, other(s.dealer), rng);
  ng.phase = "play";
  ng.log.unshift("— Rematch! Dealer alternates. —");
  // Replace the old game wholesale (legacy Object.assign) — including
  // clearing any leftover pendingCard/pendingFromSeven fields.
  delete s.pendingCard;
  delete s.pendingFromSeven;
  Object.assign(s, ng);
  return true;
}

/** Second player takes the empty seat. */
export function actJoinAsP2(s: GameState, name: string): boolean {
  if (s.names.p2 || !name.trim()) return false;
  s.names.p2 = name.trim();
  s.phase = "play";
  s.log.push(`${name.trim()} joined the game. Let's play!`);
  return true;
}
