import React, { useState, useEffect, useRef, useCallback } from "react";

// ---------- Card helpers ----------
// id 0..51 → rank 1..13 (A..K), suit 0..3 (♣ ♦ ♥ ♠, low→high)
const SUITS = ["♣", "♦", "♥", "♠"];
const SUIT_NAMES = ["clubs", "diamonds", "hearts", "spades"];
const rankOf = (id) => (id % 13) + 1;
const suitOf = (id) => Math.floor(id / 13);
const rankStr = (id) => ["A","2","3","4","5","6","7","8","9","10","J","Q","K"][rankOf(id) - 1];
const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;
const cardName = (id) => `${rankStr(id)}${SUITS[suitOf(id)]}`;
const cardPower = (id) => rankOf(id) * 4 + suitOf(id); // for scuttle comparison
const other = (p) => (p === "p1" ? "p2" : "p1");

const ONE_OFF_DESC = {
  1: "Scrap ALL point cards on the table (both sides).",
  2: "Scrap any Royal, Glasses-8 or Jack on the table — or counter a one-off.",
  3: "Take any one card from the scrap pile into your hand.",
  4: "Opponent must discard two cards of their choice.",
  5: "Draw two cards.",
  6: "Scrap ALL Royals, Glasses-8s and Jacks on the table.",
  7: "Draw the top card — you must play it immediately.",
  9: "Place any permanent on the table on top of the draw pile (house rule).",
};

// ---------- Game state ----------
function newDeck() {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function newGame(names, dealer) {
  const deck = newDeck();
  const nd = other(dealer);
  const hands = { p1: [], p2: [] };
  hands[dealer] = deck.splice(0, 6);
  hands[nd] = deck.splice(0, 5);
  return {
    v: 1,
    nonce: Math.random().toString(36).slice(2, 10),
    phase: names.p2 ? "play" : "waiting",
    turn: nd,
    actor: null,
    pending: null,
    sevenCard: null,
    discardNeed: 0,
    deck,
    scrap: [],
    hands,
    points: { p1: [], p2: [] }, // stacks: {c, jacks:[], base:'p1'|'p2'}
    royals: { p1: [], p2: [] }, // {c, g:bool} — g = glasses eight
    names,
    dealer,
    passes: 0,
    winner: null,
    log: [`Cards dealt. ${names[dealer]} is the dealer (6 cards); ${names[nd] || "Player 2"} goes first.`],
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

function pointsOf(s, p) {
  return s.points[p].reduce((t, st) => t + rankOf(st.c), 0);
}
function kingsOf(s, p) {
  return s.royals[p].filter((r) => !r.g && rankOf(r.c) === 13).length;
}
function goalOf(s, p) {
  return [21, 14, 10, 7, 5][Math.min(kingsOf(s, p), 4)];
}
function queensOf(s, p) {
  return s.royals[p].filter((r) => !r.g && rankOf(r.c) === 12);
}
// Can `attacker` target card `cardId` controlled by `ownerP`? (queens protect all OTHER cards)
function isProtected(s, ownerP, cardId) {
  return queensOf(s, ownerP).some((q) => q.c !== cardId);
}
function hasCounterTwo(s, p) {
  return s.hands[p].some((c) => rankOf(c) === 2);
}

function checkWinAndEndTurn(s) {
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

function removeFromHand(s, p, card) {
  s.hands[p] = s.hands[p].filter((c) => c !== card);
}

// Validates a card play: normal turn (card must be in hand) or forced seven play
function playGuard(s, me, card, fromSeven) {
  if (fromSeven) return s.phase === "seven" && s.actor === me && s.sevenCard === card;
  return s.phase === "play" && s.turn === me && s.hands[me].includes(card);
}

// ---------- Actions ----------
function actDraw(s, me) {
  if (s.phase !== "play" || s.turn !== me) return false;
  if (s.deck.length === 0) {
    s.passes += 1;
    s.log.push(`${s.names[me]} passes (deck is empty). (${s.passes}/3)`);
    if (s.passes >= 3) {
      s.phase = "over";
      s.winner = "draw";
      s.log.push("Three passes in a row — the game is a draw.");
      return;
    }
    s.turn = other(s.turn);
    return;
  }
  s.passes = 0;
  s.hands[me].push(s.deck.shift());
  s.log.push(`${s.names[me]} draws a card.`);
  checkWinAndEndTurn(s);
}

function actPoint(s, me, card, fromSeven) {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.points[me].push({ c: card, jacks: [], base: me });
  s.passes = 0;
  s.log.push(`${s.names[me]} plays ${cardName(card)} for points.`);
  checkWinAndEndTurn(s);
}

function actScuttle(s, me, card, targetIdx, fromSeven) {
  if (!playGuard(s, me, card, fromSeven)) return false;
  const opp0 = other(me);
  const t0 = s.points[opp0][targetIdx];
  if (!t0 || cardPower(card) <= cardPower(t0.c)) return false;
  const opp = other(me);
  const st = s.points[opp][targetIdx];
  if (!fromSeven) removeFromHand(s, me, card);
  s.scrap.push(card, st.c, ...st.jacks);
  s.points[opp].splice(targetIdx, 1);
  s.passes = 0;
  s.log.push(`${s.names[me]} scuttles ${cardName(st.c)} with ${cardName(card)}.`);
  checkWinAndEndTurn(s);
}

function actRoyal(s, me, card, glasses, fromSeven) {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.royals[me].push({ c: card, g: !!glasses });
  s.passes = 0;
  s.log.push(
    glasses
      ? `${s.names[me]} plays ${cardName(card)} as GLASSES — ${s.names[other(me)]}'s hand is revealed!`
      : `${s.names[me]} plays ${cardName(card)} as a Royal.`
  );
  checkWinAndEndTurn(s);
}

function actJack(s, me, card, targetIdx, fromSeven) {
  if (!playGuard(s, me, card, fromSeven)) return false;
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
}

function actOneOff(s, me, card, target, fromSeven) {
  if (!playGuard(s, me, card, fromSeven)) return false;
  if (!fromSeven) removeFromHand(s, me, card);
  s.passes = 0;
  s.pending = { c: card, by: me, target: target || null, counters: [], fromSeven: !!fromSeven };
  s.log.push(
    `${s.names[me]} plays ${cardName(card)} as a one-off${target ? ` targeting ${describeTarget(s, target)}` : ""}.`
  );
  advanceCounter(s);
}

function describeTarget(s, t) {
  if (t.kind === "royal") return cardName(s.royals[t.p][t.i].c);
  if (t.kind === "jack") { const st = s.points[t.p][t.i]; return cardName(st.jacks[st.jacks.length - 1]) + ` (on ${cardName(st.c)})`; }
  if (t.kind === "point") return cardName(s.points[t.p][t.i].c);
  return "?";
}

function advanceCounter(s) {
  const pd = s.pending;
  const lastBy = pd.counters.length ? pd.counters[pd.counters.length - 1].by : pd.by;
  const responder = other(lastBy);
  // responder may counter with a 2 unless lastBy has a Queen (Queens protect one-offs "in suspension")
  if (hasCounterTwo(s, responder) && queensOf(s, lastBy).length === 0) {
    s.phase = "counter";
    s.actor = responder;
  } else {
    resolvePending(s);
  }
}

function playCounterTwo(s, me, twoCard) {
  if (s.phase !== "counter" || s.actor !== me || !s.pending || !s.hands[me].includes(twoCard)) return false;
  removeFromHand(s, me, twoCard);
  s.pending.counters.push({ c: twoCard, by: me });
  s.log.push(`${s.names[me]} counters with ${cardName(twoCard)}!`);
  advanceCounter(s);
}

function declineCounter(s, me) {
  if (s.phase !== "counter" || s.actor !== me || !s.pending) return false;
  s.log.push(`${s.names[me]} lets it resolve.`);
  resolvePending(s);
}

function resolvePending(s) {
  const pd = s.pending;
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

function revertStackAfterJackRemoved(s, p, i, jackToScrap) {
  const st = s.points[p][i];
  const jack = st.jacks.pop();
  if (jackToScrap) s.scrap.push(jack);
  s.points[p].splice(i, 1);
  s.points[other(p)].push(st);
  return jack;
}

function applyOneOff(s, pd) {
  const me = pd.by, opp = other(me), r = rankOf(pd.c);
  const finish = () => { s.scrap.push(pd.c); checkWinAndEndTurn(s); };

  if (r === 1) {
    for (const p of ["p1", "p2"]) {
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
      s.log.push(`${cardName(st.jacks[st.jacks.length - 1])} is scrapped — ${cardName(st.c)} switches back.`);
      revertStackAfterJackRemoved(s, t.p, t.i, true);
    }
    finish();
  } else if (r === 3) {
    if (s.scrap.length === 0) { s.log.push("The scrap pile is empty — nothing happens."); finish(); return; }
    s.phase = "scrap_pick";
    s.actor = me;
    s._pendingCard = pd.c;
    s._fromSeven = pd.fromSeven;
  } else if (r === 4) {
    s.scrap.push(pd.c);
    const need = Math.min(2, s.hands[opp].length);
    if (need === 0) { s.log.push(`${s.names[opp]} has no cards to discard.`); checkWinAndEndTurn(s); return; }
    s.phase = "discard";
    s.actor = opp;
    s.discardNeed = need;
    s._fromSeven = pd.fromSeven;
    s.log.push(`${s.names[opp]} must discard ${need} card${need > 1 ? "s" : ""}.`);
  } else if (r === 5) {
    const n = Math.min(2, s.deck.length);
    for (let i = 0; i < n; i++) s.hands[me].push(s.deck.shift());
    s.log.push(`${s.names[me]} draws ${n} card${n === 1 ? "" : "s"}.`);
    finish();
  } else if (r === 6) {
    for (const p of ["p1", "p2"]) {
      for (const rc of s.royals[p]) s.scrap.push(rc.c);
      s.royals[p] = [];
    }
    for (const p of ["p1", "p2"]) {
      const moved = [];
      s.points[p] = s.points[p].filter((st) => {
        for (const j of st.jacks) s.scrap.push(j);
        st.jacks = [];
        if (st.base !== p) { moved.push(st); return false; }
        return true;
      });
      for (const st of moved) s.points[st.base].push(st);
    }
    s.log.push("🌪 Six: all Royals, Glasses and Jacks are scrapped. Stolen cards return home.");
    finish();
  } else if (r === 7) {
    s.scrap.push(pd.c);
    if (s.deck.length === 0) { s.log.push("The deck is empty — nothing happens."); checkWinAndEndTurn(s); return; }
    s.sevenCard = s.deck.shift();
    s.phase = "seven";
    s.actor = me;
    s.log.push(`${s.names[me]} reveals ${cardName(s.sevenCard)} from the deck and must play it.`);
  } else if (r === 9) {
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
      s.log.push(`${cardName(jc)} is placed on top of the draw pile — ${cardName(st.c)} switches back.`);
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

function actScrapPick(s, me, card) {
  if (s.phase !== "scrap_pick" || s.actor !== me || !s.scrap.includes(card)) return false;
  s.scrap = s.scrap.filter((c) => c !== card);
  s.hands[me].push(card);
  s.scrap.push(s._pendingCard);
  delete s._pendingCard;
  s.log.push(`${s.names[me]} takes ${cardName(card)} from the scrap pile.`);
  delete s._fromSeven;
  s.phase = "play";
  checkWinAndEndTurn(s);
}

function actDiscardDone(s, me, cards) {
  if (s.phase !== "discard" || s.actor !== me || cards.length !== s.discardNeed || !cards.every((c) => s.hands[me].includes(c))) return false;
  for (const c of cards) { removeFromHand(s, me, c); s.scrap.push(c); }
  s.log.push(`${s.names[me]} discards ${cards.map(cardName).join(" and ")}.`);
  s.discardNeed = 0;
  delete s._fromSeven;
  s.phase = "play";
  checkWinAndEndTurn(s);
}

function actSevenDiscard(s, me) {
  if (s.phase !== "seven" || s.actor !== me || s.sevenCard == null) return false;
  s.scrap.push(s.sevenCard);
  s.log.push(`${cardName(s.sevenCard)} cannot be played and is discarded.`);
  s.sevenCard = null;
  checkWinAndEndTurn(s);
}

// ---------- Storage ----------
const keyFor = (code) => `cuttle-room-${code}`;
let saveChain = Promise.resolve(); // serializes writes so they can't land out of order
async function saveState(code, s) {
  const payload = JSON.stringify(s);
  const p = saveChain.then(async () => {
    try {
      const r = await window.storage.set(keyFor(code), payload, true);
      return !!r;
    } catch (e) { console.error(e); return false; }
  });
  saveChain = p.catch(() => {});
  return p;
}
async function loadState(code) {
  try {
    const r = await window.storage.get(keyFor(code), true);
    return r ? JSON.parse(r.value) : null;
  } catch (e) { return null; }
}

// ---------- UI ----------
const css = `
.cuttle * { box-sizing: border-box; }
.cuttle {
  --sea:#0d2b36; --sea2:#0a222b; --sea3:#123945; --ink:#0b1a20;
  --parch:#f6efdf; --line:#2a5566; --gold:#e8b04b; --teal:#4fd6c5; --coral:#ff8a5c;
  min-height:100vh; background:linear-gradient(180deg,var(--sea2),var(--sea) 40%,#0f3140);
  color:#dcebe9; font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  padding:10px 12px 24px;
}
.cuttle h1,.cuttle h2 { font-family:Georgia,"Times New Roman",serif; letter-spacing:.5px; }
.wrap { max-width:900px; margin:0 auto; }
.topbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
.title { font-size:26px; margin:0; color:var(--teal); font-family:Georgia,serif; }
.title span { color:var(--gold); }
.pill { background:var(--sea3); border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:13px; }
.btn { background:var(--sea3); color:#eaf6f4; border:1px solid var(--line); border-radius:10px; padding:9px 14px; font-size:14px; cursor:pointer; transition:background .15s; }
.btn:hover { background:#1a4a5a; }
.btn.primary { background:var(--gold); color:#3a2a08; border-color:#c8912f; font-weight:600; }
.btn.primary:hover { background:#f2c065; }
.btn.warn { background:#7c3b2a; border-color:#a35441; }
.btn.small { padding:5px 10px; font-size:12px; border-radius:8px; }
.btn:disabled { opacity:.45; cursor:default; }
.zone { background:rgba(255,255,255,.03); border:1px solid var(--line); border-radius:14px; padding:10px; margin-bottom:10px; }
.zone.mine { border-color:#3a7a70; }
.zonehead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; flex-wrap:wrap; gap:4px; }
.pname { font-weight:600; font-size:15px; color:#fff; }
.pts { font-size:13px; color:var(--gold); }
.rowlabel { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#7fa8a3; margin:6px 0 3px; }
.cardrow { display:flex; flex-wrap:wrap; gap:6px; min-height:14px; }
.card { width:54px; height:76px; border-radius:7px; background:var(--parch); color:#1c1c1c; position:relative;
  border:1px solid #b9ad8e; box-shadow:0 2px 4px rgba(0,0,0,.35); cursor:default; flex:0 0 auto;
  font-weight:700; user-select:none; }
.card.red { color:#c0392b; }
.card .corner { position:absolute; font-size:12px; line-height:1.05; text-align:center; }
.card .corner .csuit { font-size:11px; line-height:1; }
.card .corner.tl { top:4px; left:5px; }
.card .corner.br { bottom:4px; right:5px; transform:rotate(180deg); }
.card .mid { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:26px; }
.card.click { cursor:pointer; }
.card.click:hover { transform:translateY(-3px); box-shadow:0 5px 10px rgba(0,0,0,.45); }
.card.sel { outline:3px solid var(--gold); transform:translateY(-4px); }
.card.target { outline:3px solid var(--coral); animation:pulse 1s infinite; cursor:pointer; }
@keyframes pulse { 50% { outline-color:#ffd0bd; } }
.card.back { background:repeating-linear-gradient(45deg,#17505f,#17505f 6px,#0e3b48 6px,#0e3b48 12px); border-color:#0a2e38; }
.card.small { width:40px; height:56px; }
.card.small .corner { font-size:10px; } .card.small .corner .csuit { font-size:9px; } .card.small .mid { font-size:17px; }
.stack { position:relative; }
.jackchips { position:absolute; top:-8px; right:-8px; display:flex; flex-direction:column; gap:2px; }
.jackchip { background:#3b2f63; color:#cfc3ff; border:1px solid #6a5aa8; font-size:10px; border-radius:6px; padding:1px 4px; font-weight:700; }
.jackchip.target { outline:2px solid var(--coral); animation:pulse 1s infinite; }
.glasscard { transform:rotate(90deg); margin:0 12px; }
.center { display:flex; gap:10px; align-items:stretch; margin-bottom:10px; flex-wrap:wrap; }
.deckbox { background:var(--sea3); border:1px solid var(--line); border-radius:12px; padding:8px 12px; display:flex; align-items:center; gap:10px; }
.turnbanner { flex:1; min-width:200px; background:var(--sea3); border:1px solid var(--line); border-radius:12px; padding:8px 12px; display:flex; align-items:center; font-size:14px; }
.turnbanner.you { border-color:var(--gold); color:var(--gold); font-weight:600; }
.actions { background:#143c4a; border:1px solid #2b6273; border-radius:12px; padding:10px; margin-bottom:10px; }
.actions .arow { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.hint { font-size:13px; color:#9fc6c0; }
.overlay { position:fixed; inset:0; background:rgba(4,14,18,.75); display:flex; align-items:center; justify-content:center; z-index:50; padding:14px; }
.modal { background:var(--sea); border:1px solid var(--line); border-radius:16px; padding:16px; max-width:560px; width:100%; max-height:85vh; overflow:auto; }
.modal h2 { margin:0 0 8px; font-size:19px; color:var(--teal); }
.log { background:rgba(0,0,0,.25); border:1px solid var(--line); border-radius:12px; padding:8px 12px; font-size:12.5px; max-height:130px; overflow:auto; color:#b9d4d0; }
.log div { padding:1.5px 0; }
input.txt { background:#0d2f3b; border:1px solid var(--line); color:#eaf6f4; border-radius:10px; padding:10px 12px; font-size:15px; width:100%; }
.lobbycard { max-width:430px; margin:8vh auto 0; background:rgba(255,255,255,.04); border:1px solid var(--line); border-radius:18px; padding:22px; }
.codebig { font-size:34px; letter-spacing:8px; color:var(--gold); font-family:Georgia,serif; text-align:center; margin:8px 0; }
.notice { background:#4a3413; border:1px solid #8a6a2c; color:#ffd98a; border-radius:10px; padding:8px 12px; font-size:13px; margin-bottom:10px; }
.errormsg { color:#ff9b8a; font-size:13px; margin-top:8px; }
@media (max-width:520px){ .card{width:46px;height:66px;} .title{font-size:21px;} }
`;

function CardV({ id, onClick, sel, target, small, back }) {
  if (back)
    return <div className={`card back ${small ? "small" : ""}`} />;
  return (
    <div
      className={`card ${isRed(id) ? "red" : ""} ${onClick ? "click" : ""} ${sel ? "sel" : ""} ${target ? "target" : ""} ${small ? "small" : ""}`}
      onClick={onClick}
    >
      <div className="corner tl">{rankStr(id)}<div className="csuit">{SUITS[suitOf(id)]}</div></div>
      <div className="mid">{SUITS[suitOf(id)]}</div>
      <div className="corner br">{rankStr(id)}<div className="csuit">{SUITS[suitOf(id)]}</div></div>
    </div>
  );
}

export default function CuttleOnline() {
  const [screen, setScreen] = useState("lobby"); // lobby | game
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [code, setCode] = useState(null);
  const [seat, setSeat] = useState(null);
  const [game, setGame] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState(null);

  // UI-local
  const [selCard, setSelCard] = useState(null);
  const [targetMode, setTargetMode] = useState(null); // {type:'scuttle'|'jack'|'two'|'nine', card, fromSeven}
  const [showScrap, setShowScrap] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [discardSel, setDiscardSel] = useState([]);
  const gameRef = useRef(game);
  gameRef.current = game;

  const commit = useCallback((mutator) => {
    const base = gameRef.current;
    if (!base) return;
    const s = clone(base);
    if (mutator(s) === false) return; // mutator aborted (stale click / wrong phase)
    s.v = (s.v || 0) + 1;
    s.nonce = Math.random().toString(36).slice(2, 10);
    gameRef.current = s;
    setGame(s);
    saveState(code, s);
    setSelCard(null);
    setTargetMode(null);
  }, [code]);

  // Poll for opponent moves (and self-heal if the server holds a stale version)
  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      const remote = await loadState(code);
      const local = gameRef.current;
      if (!remote) return;
      if (!local || remote.v > local.v) {
        setGame(remote);
        setSelCard(null); setTargetMode(null); setDiscardSel([]);
      } else if (remote.v < local.v) {
        // A newer write got overwritten by a slower older one — repair it.
        saveState(code, local);
      } else if ((remote.nonce || "") !== (local.nonce || "")) {
        // Same version, different state: both clients wrote simultaneously.
        // Resolve deterministically so both sides converge on ONE reality.
        if ((remote.nonce || "") < (local.nonce || "")) {
          setGame(remote);
          setSelCard(null); setTargetMode(null); setDiscardSel([]);
        } else {
          saveState(code, local);
        }
      }
    }, 1800);
    return () => clearInterval(t);
  }, [code]);

  // ---------- Lobby actions ----------
  const createGame = async () => {
    if (!name.trim()) { setErr("Enter your name first."); return; }
    setBusy(true); setErr("");
    const c = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
    const s = newGame({ p1: name.trim(), p2: "" }, "p1");
    await saveState(c, s);
    const check = await loadState(c);
    if (!check) {
      setErr("Couldn't write to shared storage from here. Open the PUBLISHED artifact link (not the in-chat preview) and create the game there — both players must use the exact same link.");
      setBusy(false);
      return;
    }
    setCode(c); setSeat("p1"); setGame(s); setScreen("game"); setBusy(false);
  };

  const listRooms = async () => {
    setBusy(true); setErr(""); setRooms(null);
    try {
      const r = await window.storage.list("cuttle-room-", true);
      const keys = (r && r.keys ? r.keys : []).map((k) => (typeof k === "string" ? k : k.key)).slice(0, 15);
      const out = [];
      for (const k of keys) {
        try {
          const g = await window.storage.get(k, true);
          const st = JSON.parse(g.value);
          out.push({ code: k.replace("cuttle-room-", ""), p1: st.names.p1, p2: st.names.p2, phase: st.phase });
        } catch (e) {}
      }
      setRooms(out);
      if (out.length === 0) setErr("No rooms exist in this app's shared storage yet. If your friend already created one, you two are on different links — both must open the exact same published artifact.");
    } catch (e) {
      setErr("Shared storage isn't reachable from here. Use the published artifact link on both devices.");
    }
    setBusy(false);
  };

  const joinGame = async (asSeat, directCode) => {
    if (!name.trim()) { setErr("Enter your name first."); return; }
    const c = (directCode || joinCode).trim().toUpperCase();
    if (c.length < 3) { setErr("Enter the room code your friend gave you."); return; }
    setBusy(true); setErr("");
    const s = await loadState(c);
    if (!s) { setErr("No game found with that code. Check the code (and that you're both using the same shared link)."); setBusy(false); return; }
    if (asSeat) {
      setCode(c); setSeat(asSeat); setGame(s); setScreen("game"); setBusy(false); return;
    }
    if (!s.names.p2) {
      const ns = clone(s);
      ns.names.p2 = name.trim();
      ns.phase = "play";
      ns.log.push(`${name.trim()} joined the game. Let's play!`);
      ns.v++;
      await saveState(c, ns);
      setCode(c); setSeat("p2"); setGame(ns); setScreen("game");
    } else if (s.names.p1 === name.trim()) { setCode(c); setSeat("p1"); setGame(s); setScreen("game"); }
    else if (s.names.p2 === name.trim()) { setCode(c); setSeat("p2"); setGame(s); setScreen("game"); }
    else { setErr(`This room already has two players (${s.names.p1} and ${s.names.p2}). Enter one of those names exactly to rejoin.`); }
    setBusy(false);
  };

  // ---------- Derived ----------
  if (screen === "lobby") {
    return (
      <div className="cuttle">
        <style>{css}</style>
        <div className="lobbycard">
          <h1 className="title" style={{ textAlign: "center", fontSize: 34 }}>🦑 Cuttle <span>Online</span></h1>
          <p className="hint" style={{ textAlign: "center", marginTop: 4 }}>The 1975 combat card game — play with a friend over the internet.</p>
          <div style={{ marginTop: 18 }}>
            <div className="rowlabel">Your name</div>
            <input className="txt" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nether" maxLength={16} />
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="btn primary" style={{ width: "100%" }} disabled={busy} onClick={createGame}>Create a new game</button>
          </div>
          <div style={{ textAlign: "center", margin: "14px 0 6px", color: "#7fa8a3", fontSize: 13 }}>— or join a friend's game —</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="txt" style={{ letterSpacing: 3, textTransform: "uppercase" }} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="CODE" maxLength={6} />
            <button className="btn" disabled={busy} onClick={() => joinGame()}>Join</button>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="btn small" disabled={busy} onClick={listRooms}>Show open rooms</button>
          </div>
          {rooms && rooms.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {rooms.map((r) => (
                <div key={r.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                  <span><b style={{ color: "var(--gold)", letterSpacing: 2 }}>{r.code}</b> · {r.p1}{r.p2 ? ` vs ${r.p2}` : " · waiting for opponent"}</span>
                  <button className="btn small" onClick={() => { setJoinCode(r.code); joinGame(null, r.code); }}>Join</button>
                </div>
              ))}
            </div>
          )}
          {err && <div className="errormsg">{err}</div>}
          <p className="hint" style={{ marginTop: 16, fontSize: 12 }}>
            ⚠️ Important: both players must open the <b>same published link</b> — the in-chat preview and the published app don't share data. Room codes never contain the letters I or O.
          </p>
        </div>
      </div>
    );
  }

  if (!game) return <div className="cuttle"><style>{css}</style><div className="wrap"><p>Loading…</p></div></div>;

  const s = game;
  const me = seat, opp = other(seat);
  const myTurn = s.turn === me && s.phase === "play";
  const oppGlassesOnMe = s.royals[opp].some((r) => r.g); // opponent sees my hand
  const iSeeOppHand = s.royals[me].some((r) => r.g);
  const myPts = pointsOf(s, me), oppPts = pointsOf(s, opp);
  const myGoal = goalOf(s, me), oppGoal = goalOf(s, opp);

  // valid scuttle targets for a card
  const scuttleTargets = (card) => s.points[opp].map((st, i) => (cardPower(card) > cardPower(st.c) ? i : -1)).filter((i) => i >= 0);
  const jackTargets = () => (queensOf(s, opp).length > 0 ? [] : s.points[opp].map((_, i) => i));
  // targets for 2 (royals/glasses/jacks, any side; opp side respects queens)
  const twoTargets = () => {
    const out = [];
    for (const p of ["p1", "p2"]) {
      s.royals[p].forEach((r, i) => { if (p === me || !isProtected(s, p, r.c)) out.push({ kind: "royal", p, i }); });
      s.points[p].forEach((st, i) => { if (st.jacks.length > 0 && (p === me || !isProtected(s, p, st.jacks[st.jacks.length - 1]))) out.push({ kind: "jack", p, i }); });
    }
    return out;
  };
  const nineTargets = () => {
    const out = [];
    for (const p of ["p1", "p2"]) {
      s.royals[p].forEach((r, i) => { if (p === me || !isProtected(s, p, r.c)) out.push({ kind: "royal", p, i }); });
      s.points[p].forEach((st, i) => {
        if (st.jacks.length > 0 && (p === me || !isProtected(s, p, st.jacks[st.jacks.length - 1]))) out.push({ kind: "jack", p, i });
        if (p === me || !isProtected(s, p, st.c)) out.push({ kind: "point", p, i });
      });
    }
    return out;
  };
  const isTgt = (kind, p, i) => targetMode && (
    (targetMode.type === "scuttle" && kind === "point" && p === opp && targetMode.targets.includes(i)) ||
    (targetMode.type === "jack" && kind === "point" && p === opp && targetMode.targets.includes(i)) ||
    ((targetMode.type === "two" || targetMode.type === "nine") && targetMode.targets.some((t) => t.kind === kind && t.p === p && t.i === i))
  );

  const clickTarget = (kind, p, i) => {
    if (!targetMode) return;
    const { type, card, fromSeven } = targetMode;
    if (type === "scuttle") commit((g) => actScuttle(g, me, card, i, fromSeven));
    else if (type === "jack") commit((g) => actJack(g, me, card, i, fromSeven));
    else commit((g) => actOneOff(g, me, card, { kind, p, i }, fromSeven));
  };

  // Action menu for a card (from hand, or the seven card)
  const ActionMenu = ({ card, fromSeven }) => {
    const r = rankOf(card);
    const opts = [];
    if (r <= 10) opts.push(<button key="pt" className="btn primary" onClick={() => commit((g) => actPoint(g, me, card, fromSeven))}>Play for {r} point{r > 1 ? "s" : ""}</button>);
    if (r <= 10 && scuttleTargets(card).length > 0)
      opts.push(<button key="sc" className="btn" onClick={() => setTargetMode({ type: "scuttle", card, fromSeven, targets: scuttleTargets(card) })}>Scuttle a point card…</button>);
    if (ONE_OFF_DESC[r]) {
      let ok = true;
      if (r === 3 && s.scrap.length === 0) ok = false;
      if (r === 4 && s.hands[opp].length === 0) ok = false;
      if (r === 7 && s.deck.length === 0) ok = false;
      if (r === 2 && twoTargets().length === 0) ok = false;
      if (r === 9 && nineTargets().length === 0) ok = false;
      if (ok) {
        if (r === 2) opts.push(<button key="oo" className="btn" onClick={() => setTargetMode({ type: "two", card, fromSeven, targets: twoTargets() })}>One-off: scrap a Royal/Jack…</button>);
        else if (r === 9) opts.push(<button key="oo" className="btn" onClick={() => setTargetMode({ type: "nine", card, fromSeven, targets: nineTargets() })}>One-off: bounce a permanent…</button>);
        else opts.push(<button key="oo" className="btn" onClick={() => commit((g) => actOneOff(g, me, card, null, fromSeven))}>One-off: {ONE_OFF_DESC[r]}</button>);
      }
    }
    if (r === 11 && jackTargets().length > 0)
      opts.push(<button key="jk" className="btn" onClick={() => setTargetMode({ type: "jack", card, fromSeven, targets: jackTargets() })}>Steal a point card…</button>);
    if (r === 11 && queensOf(s, opp).length > 0)
      opts.push(<span key="jq" className="hint">Jack is blocked — {s.names[opp]} has a Queen.</span>);
    if (r === 12 || r === 13) opts.push(<button key="ry" className="btn" onClick={() => commit((g) => actRoyal(g, me, card, false, fromSeven))}>Play as Royal ({r === 12 ? "Queen: protects your cards" : "King: lowers your goal"})</button>);
    if (r === 8) opts.push(<button key="gl" className="btn" onClick={() => commit((g) => actRoyal(g, me, card, true, fromSeven))}>Play as Glasses 👓 (reveal their hand)</button>);
    const noPlay = opts.filter((o) => o.type === "button" || (o.key && o.key !== "jq")).length === 0;
    return (
      <div className="actions">
        <div><b>{cardName(card)}</b> — {fromSeven ? "you must play this card now:" : "choose an action:"}</div>
        <div className="arow">
          {opts}
          {fromSeven && noPlay && <button className="btn warn" onClick={() => commit((g) => actSevenDiscard(g, me))}>No legal play — discard it</button>}
          {!fromSeven && <button className="btn small" onClick={() => { setSelCard(null); setTargetMode(null); }}>Cancel</button>}
        </div>
        {targetMode && <div className="hint" style={{ marginTop: 8 }}>👉 Tap a highlighted card on the table{" "}<button className="btn small" onClick={() => setTargetMode(null)}>cancel target</button></div>}
      </div>
    );
  };

  const Field = ({ p }) => (
    <>
      <div className="rowlabel">Royals</div>
      <div className="cardrow">
        {s.royals[p].length === 0 && <span className="hint">—</span>}
        {s.royals[p].map((r, i) => (
          <div key={i} className={r.g ? "glasscard" : ""}>
            <CardV id={r.c} target={isTgt("royal", p, i)} onClick={isTgt("royal", p, i) ? () => clickTarget("royal", p, i) : undefined} />
          </div>
        ))}
      </div>
      <div className="rowlabel">Point cards {p === me ? `(you: ${pointsOf(s, p)}/${goalOf(s, p)})` : `(${pointsOf(s, p)}/${goalOf(s, p)})`}</div>
      <div className="cardrow">
        {s.points[p].length === 0 && <span className="hint">—</span>}
        {s.points[p].map((st, i) => {
          const jackT = isTgt("jack", p, i), pointT = isTgt("point", p, i);
          return (
            <div key={i} className="stack">
              <CardV id={st.c} target={pointT} onClick={pointT ? () => clickTarget("point", p, i) : (jackT ? () => clickTarget("jack", p, i) : undefined)} />
              {st.jacks.length > 0 && (
                <div className="jackchips" onClick={jackT ? () => clickTarget("jack", p, i) : undefined} style={jackT ? { cursor: "pointer" } : {}}>
                  {st.jacks.map((j, k) => <div key={k} className={`jackchip ${jackT ? "target" : ""}`}>J{SUITS[suitOf(j)]}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );

  const waitingForP2 = s.phase === "waiting";
  const counterMine = s.phase === "counter" && s.actor === me;
  const discardMine = s.phase === "discard" && s.actor === me;
  const scrapPickMine = s.phase === "scrap_pick" && s.actor === me;
  const sevenMine = s.phase === "seven" && s.actor === me;
  const myTwos = s.hands[me].filter((c) => rankOf(c) === 2);

  let banner;
  if (s.phase === "over") banner = s.winner === "draw" ? "Game over — it's a draw." : `Game over — ${s.names[s.winner]} wins! 🏆`;
  else if (waitingForP2) banner = "Waiting for your friend to join…";
  else if (s.phase === "counter") banner = counterMine ? "Respond to the one-off!" : `Waiting for ${s.names[s.actor]} to respond…`;
  else if (s.phase === "discard") banner = discardMine ? `Discard ${s.discardNeed} card${s.discardNeed > 1 ? "s" : ""} from your hand` : `${s.names[s.actor]} is discarding…`;
  else if (s.phase === "scrap_pick") banner = scrapPickMine ? "Pick a card from the scrap pile" : `${s.names[s.actor]} is rummaging through the scrap…`;
  else if (s.phase === "seven") banner = sevenMine ? "Seven: play the revealed card!" : `${s.names[s.actor]} must play a revealed card…`;
  else banner = myTurn ? "Your turn — play a card or draw" : `${s.names[s.turn]}'s turn…`;

  return (
    <div className="cuttle">
      <style>{css}</style>
      <div className="wrap">
        <div className="topbar">
          <h1 className="title">🦑 Cuttle <span>Online</span></h1>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pill">Room <b style={{ color: "var(--gold)", letterSpacing: 2 }}>{code}</b></span>
            <button className="btn small" onClick={() => setShowRules(true)}>Rules</button>
            <button className="btn small" onClick={() => setShowScrap(true)}>Scrap ({s.scrap.length})</button>
          </div>
        </div>

        {waitingForP2 && (
          <div className="notice">Share the room code <b style={{ letterSpacing: 2 }}>{code}</b> with your friend. They open this same app, enter their name and the code, and hit Join. This screen updates automatically when they arrive.</div>
        )}
        {oppGlassesOnMe && <div className="notice">👓 {s.names[opp]} has Glasses in play — your hand is revealed to them!</div>}

        {/* Opponent zone */}
        <div className="zone">
          <div className="zonehead">
            <span className="pname">{s.names[opp] || "Waiting…"} {s.turn === opp && s.phase !== "over" ? "· their turn" : ""}</span>
            <span className="pts">{oppPts} / {oppGoal} pts · {kingsOf(s, opp)}♚ · {s.hands[opp].length} in hand</span>
          </div>
          <div className="rowlabel">Hand</div>
          <div className="cardrow">
            {s.hands[opp].map((c, i) => iSeeOppHand ? <CardV key={i} id={c} small /> : <CardV key={i} back small />)}
            {s.hands[opp].length === 0 && <span className="hint">empty</span>}
          </div>
          <Field p={opp} />
        </div>

        {/* Center strip */}
        <div className="center">
          <div className="deckbox">
            <CardV back small />
            <div>
              <div style={{ fontSize: 13 }}>Deck: <b>{s.deck.length}</b></div>
              <button className="btn small" disabled={!myTurn} onClick={() => commit((g) => actDraw(g, me))}>
                {s.deck.length === 0 ? "Pass" : "Draw"}
              </button>
            </div>
          </div>
          <div className={`turnbanner ${myTurn || counterMine || discardMine || scrapPickMine || sevenMine ? "you" : ""}`}>{banner}</div>
        </div>

        {/* Seven panel */}
        {sevenMine && s.sevenCard != null && (
          <div className="actions" style={{ borderColor: "var(--gold)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <CardV id={s.sevenCard} />
              <div><b>Revealed by your Seven.</b><div className="hint">You must play this card immediately if possible.</div></div>
            </div>
            <ActionMenu card={s.sevenCard} fromSeven />
          </div>
        )}

        {/* My zone */}
        <div className="zone mine">
          <div className="zonehead">
            <span className="pname">{s.names[me]} (you) {myTurn ? "· your turn" : ""}</span>
            <span className="pts">{myPts} / {myGoal} pts · {kingsOf(s, me)}♚</span>
          </div>
          <Field p={me} />
          <div className="rowlabel">Your hand</div>
          <div className="cardrow">
            {s.hands[me].map((c, i) => (
              <CardV key={i} id={c} sel={selCard === c} onClick={myTurn && !targetMode ? () => setSelCard(selCard === c ? null : c) : undefined} />
            ))}
            {s.hands[me].length === 0 && <span className="hint">empty</span>}
          </div>
        </div>

        {myTurn && selCard != null && !sevenMine && <ActionMenu card={selCard} />}

        {/* Log */}
        <div className="log">
          {s.log.slice(-30).reverse().map((l, i) => <div key={i}>{l}</div>)}
        </div>

        {s.phase === "over" && (
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <h2 style={{ color: "var(--gold)" }}>{s.winner === "draw" ? "Draw game!" : `${s.names[s.winner]} wins! 🏆`}</h2>
            {(s.winner === "draw" ? me === "p1" : s.winner === me) ? (
              <button className="btn primary" onClick={() => commit((g) => {
                if (g.phase !== "over") return false;
                const ng = newGame(g.names, other(g.dealer));
                ng.v = g.v; ng.phase = "play";
                ng.log.unshift("— Rematch! Dealer alternates. —");
                Object.assign(g, ng);
              })}>Rematch</button>
            ) : (
              <p className="hint">Waiting for {s.winner === "draw" ? s.names.p1 : s.names[s.winner]} to start the rematch…</p>
            )}
          </div>
        )}
      </div>

      {/* Counter modal */}
      {s.phase === "counter" && s.pending && counterMine && (
        <div className="overlay"><div className="modal">
          <h2>One-off incoming!</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <CardV id={s.pending.c} />
            <div>
              <b>{s.names[s.pending.by]}</b> played <b>{cardName(s.pending.c)}</b>:
              <div className="hint">{ONE_OFF_DESC[rankOf(s.pending.c)]}</div>
              {s.pending.counters.length > 0 && <div className="hint" style={{ marginTop: 4 }}>Counter chain: {s.pending.counters.map((x) => cardName(x.c)).join(" ← ")} {s.pending.counters.length % 2 === 1 ? "(currently countered)" : "(currently resolving)"}</div>}
            </div>
          </div>
          <div className="arow" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {myTwos.map((c) => <button key={c} className="btn warn" onClick={() => commit((g) => playCounterTwo(g, me, c))}>Counter with {cardName(c)}</button>)}
            <button className="btn primary" onClick={() => commit((g) => declineCounter(g, me))}>Let it resolve</button>
          </div>
        </div></div>
      )}

      {/* Discard modal (Four) */}
      {discardMine && (
        <div className="overlay"><div className="modal">
          <h2>Discard {s.discardNeed} card{s.discardNeed > 1 ? "s" : ""}</h2>
          <p className="hint">A Four resolved against you. Choose {s.discardNeed} card{s.discardNeed > 1 ? "s" : ""} to scrap.</p>
          <div className="cardrow" style={{ margin: "10px 0" }}>
            {s.hands[me].map((c, i) => (
              <CardV key={i} id={c} sel={discardSel.includes(c)} onClick={() => setDiscardSel((d) => d.includes(c) ? d.filter((x) => x !== c) : (d.length < s.discardNeed ? [...d, c] : d))} />
            ))}
          </div>
          <button className="btn primary" disabled={discardSel.length !== s.discardNeed} onClick={() => { const sel = discardSel; setDiscardSel([]); commit((g) => actDiscardDone(g, me, sel)); }}>
            Discard selected
          </button>
        </div></div>
      )}

      {/* Scrap pick modal (Three) */}
      {scrapPickMine && (
        <div className="overlay"><div className="modal">
          <h2>Rummage the scrap pile</h2>
          <p className="hint">Take one card into your hand.</p>
          <div className="cardrow" style={{ margin: "10px 0" }}>
            {s.scrap.map((c, i) => <CardV key={i} id={c} onClick={() => commit((g) => actScrapPick(g, me, c))} />)}
          </div>
        </div></div>
      )}

      {/* Scrap viewer */}
      {showScrap && (
        <div className="overlay" onClick={() => setShowScrap(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Scrap pile ({s.scrap.length})</h2>
          <p className="hint">Face up and public. Cards here don't affect the game.</p>
          <div className="cardrow" style={{ margin: "10px 0" }}>
            {s.scrap.length === 0 && <span className="hint">empty</span>}
            {s.scrap.map((c, i) => <CardV key={i} id={c} small />)}
          </div>
          <button className="btn" onClick={() => setShowScrap(false)}>Close</button>
        </div></div>
      )}

      {/* Rules */}
      {showRules && (
        <div className="overlay" onClick={() => setShowRules(false)}><div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Quick rules</h2>
          <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
            <p><b>Goal:</b> end your turn with point cards worth <b>21+</b> (less with Kings: 14 / 10 / 7 / 5).</p>
            <p><b>On your turn:</b> draw a card, or play one card — as points (A–10), as a scuttle, as a one-off, or as a Royal/Glasses.</p>
            <p><b>Scuttle:</b> an A–10 from your hand destroys an opponent's lower point card (rank first, then suit ♣&lt;♦&lt;♥&lt;♠). Both go to scrap.</p>
            <p><b>One-offs</b> (card goes to scrap): A = scrap all points · 2 = scrap a Royal/Jack, or counter a one-off (playable anytime!) · 3 = take from scrap · 4 = opponent discards 2 · 5 = draw 2 · 6 = scrap all Royals/Jacks · 7 = draw & play immediately · 9 = put a permanent on top of the draw pile (house rule).</p>
            <p><b>Royals:</b> Jack steals a point card · Queen protects your other cards from Jacks, 2s and 9s (not scuttles or Aces/Sixes) · King lowers your goal · 8 can be played sideways as Glasses to reveal the opponent's hand.</p>
            <p><b>Empty deck:</b> drawing becomes a pass; three passes in a row is a draw.</p>
          </div>
          <button className="btn" onClick={() => setShowRules(false)}>Close</button>
        </div></div>
      )}
    </div>
  );
}
