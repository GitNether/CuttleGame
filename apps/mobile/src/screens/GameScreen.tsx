import {
  ONE_OFF_DESC,
  actDiscardDone,
  actDraw,
  actJack,
  actOneOff,
  actPoint,
  actRematch,
  actRoyal,
  actScrapPick,
  actScuttle,
  actSevenDiscard,
  cardName,
  declineCounter,
  goalOf,
  jackTargets,
  kingsOf,
  playCounterTwo,
  pointsOf,
  queensOf,
  rankOf,
  scuttleTargets,
  suitOf,
  SUITS,
  nineTargets,
  other,
  twoTargets,
  type Card,
  type GameState,
  type PlayerId,
  type Target,
  type TargetKind,
} from "@cuttle/engine";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CardView } from "../components/CardView";
import { Btn, Hint, Notice, RowLabel, Sheet } from "../components/ui";
import { commitMove, refreshSeatPushToken, subscribeRoom, whoActsNext, type RoomDoc } from "../sync";
import { sendTurnNotification } from "../notifications";
import { colors } from "../theme";

interface Props {
  code: string;
  seat: PlayerId;
  pushToken: string | null;
  onLeave: () => void;
}

interface TargetMode {
  type: "scuttle" | "jack" | "two" | "nine";
  card: Card;
  fromSeven?: boolean;
  targets: number[] | Target[];
}

export function GameScreen({ code, seat, pushToken, onLeave }: Props) {
  const [room, setRoom] = useState<RoomDoc | null | undefined>(undefined);
  const [selCard, setSelCard] = useState<Card | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode | null>(null);
  const [discardSel, setDiscardSel] = useState<Card[]>([]);
  const [showScrap, setShowScrap] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);

  const roomRef = useRef(room);
  roomRef.current = room;
  const lastVersion = useRef(0);

  useEffect(() => {
    const unsub = subscribeRoom(code, (doc) => {
      setRoom(doc);
      // A newer remote state invalidates any in-flight selection.
      if (doc && doc.version !== lastVersion.current) {
        lastVersion.current = doc.version;
        setSelCard(null);
        setTargetMode(null);
        setDiscardSel([]);
      }
    });
    // After a long suspension the listener may take a moment; nothing else
    // needed — Firestore resumes the stream when the app foregrounds.
    const sub = AppState.addEventListener("change", () => {});
    return () => {
      unsub();
      sub.remove();
    };
  }, [code]);

  // Store our push token on our seat once it's available (it may resolve after
  // create/join, when the OS permission prompt is answered).
  useEffect(() => {
    if (pushToken) void refreshSeatPushToken(code, pushToken);
  }, [code, pushToken]);

  const commit = useCallback(
    async (mutator: (g: GameState) => boolean) => {
      const base = roomRef.current;
      if (!base || busy) return;
      setBusy(true);
      try {
        // A Firestore transaction can hang indefinitely on a flaky
        // connection. Race it against a timeout so `busy` can never get
        // stuck true — which would otherwise dead-lock every button. The
        // version check makes a late-arriving write harmless, and the
        // snapshot listener always delivers the authoritative state.
        const result = await Promise.race([
          commitMove(code, base.version, mutator),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("commit-timeout")), 15000)
          ),
        ]);
        // If my move handed the action to my opponent, ping their device.
        const opponent = other(seat);
        if (whoActsNext(result.state) === opponent) {
          const token = result.players[opponent]?.pushToken;
          if (token) void sendTurnNotification(token, code, result.state.names[seat]);
        }
        setSelCard(null);
        setTargetMode(null);
      } catch {
        // stale base, guard refusal, timeout, or network hiccup — the
        // snapshot listener holds the truth; selections are left intact so
        // the user can simply try again.
      } finally {
        setBusy(false);
      }
    },
    [code, busy]
  );

  if (room === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.teal} size="large" />
        <Hint style={{ marginTop: 12 }}>Connecting to room {code}…</Hint>
      </View>
    );
  }
  if (room === null) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: colors.text, fontSize: 16, marginBottom: 12 }}>
          This room no longer exists — it may have expired.
        </Text>
        <Btn title="Back to lobby" onPress={onLeave} />
      </View>
    );
  }

  const s = room.state;
  const me = seat;
  const opp = other(seat);
  const myTurn = s.turn === me && s.phase === "play";
  const oppGlassesOnMe = s.royals[opp].some((r) => r.g);
  const iSeeOppHand = s.royals[me].some((r) => r.g);

  const waitingForP2 = s.phase === "waiting";
  const counterMine = s.phase === "counter" && s.actor === me;
  const discardMine = s.phase === "discard" && s.actor === me;
  const scrapPickMine = s.phase === "scrap_pick" && s.actor === me;
  const sevenMine = s.phase === "seven" && s.actor === me;
  const myTwos = s.hands[me].filter((c) => rankOf(c) === 2);

  const isTgt = (kind: TargetKind, p: PlayerId, i: number): boolean => {
    if (!targetMode) return false;
    if (targetMode.type === "scuttle" || targetMode.type === "jack")
      return kind === "point" && p === opp && (targetMode.targets as number[]).includes(i);
    return (targetMode.targets as Target[]).some((t) => t.kind === kind && t.p === p && t.i === i);
  };

  const clickTarget = (kind: TargetKind, p: PlayerId, i: number) => {
    if (!targetMode) return;
    const { type, card, fromSeven } = targetMode;
    if (type === "scuttle") commit((g) => actScuttle(g, me, card, i, fromSeven));
    else if (type === "jack") commit((g) => actJack(g, me, card, i, fromSeven));
    else commit((g) => actOneOff(g, me, card, { kind, p, i }, fromSeven));
  };

  let banner: string;
  if (s.phase === "over")
    banner = s.winner === "draw" ? "Game over — it's a draw." : `Game over — ${s.names[s.winner as PlayerId]} wins! 🏆`;
  else if (waitingForP2) banner = "Waiting for your friend to join…";
  else if (s.phase === "counter")
    banner = counterMine ? "Respond to the one-off!" : `Waiting for ${s.names[s.actor!]} to respond…`;
  else if (s.phase === "discard")
    banner = discardMine
      ? `Discard ${s.discardNeed} card${s.discardNeed > 1 ? "s" : ""} from your hand`
      : `${s.names[s.actor!]} is discarding…`;
  else if (s.phase === "scrap_pick")
    banner = scrapPickMine
      ? "Pick a card from the scrap pile"
      : `${s.names[s.actor!]} is rummaging through the scrap…`;
  else if (s.phase === "seven")
    banner = sevenMine ? "Seven: play the revealed card!" : `${s.names[s.actor!]} must play a revealed card…`;
  else banner = myTurn ? "Your turn — play a card or draw" : `${s.names[s.turn]}'s turn…`;

  const ActionMenu = ({ card, fromSeven }: { card: Card; fromSeven?: boolean }) => {
    const r = rankOf(card);
    const opts: React.ReactNode[] = [];
    if (r <= 10)
      opts.push(
        <Btn
          key="pt"
          kind="primary"
          title={`Play for ${r} point${r > 1 ? "s" : ""}`}
          onPress={() => commit((g) => actPoint(g, me, card, fromSeven))}
        />
      );
    if (r <= 10 && scuttleTargets(s, me, card).length > 0)
      opts.push(
        <Btn
          key="sc"
          title="Scuttle a point card…"
          onPress={() =>
            setTargetMode({ type: "scuttle", card, fromSeven, targets: scuttleTargets(s, me, card) })
          }
        />
      );
    if (ONE_OFF_DESC[r]) {
      let ok = true;
      if (r === 3 && s.scrap.length === 0) ok = false;
      if (r === 4 && s.hands[opp].length === 0) ok = false;
      if (r === 7 && s.deck.length === 0) ok = false;
      if (r === 2 && twoTargets(s, me).length === 0) ok = false;
      if (r === 9 && nineTargets(s, me).length === 0) ok = false;
      if (ok) {
        if (r === 2)
          opts.push(
            <Btn
              key="oo"
              title="One-off: scrap a Royal/Jack…"
              onPress={() => setTargetMode({ type: "two", card, fromSeven, targets: twoTargets(s, me) })}
            />
          );
        else if (r === 9)
          opts.push(
            <Btn
              key="oo"
              title="One-off: bounce a permanent…"
              onPress={() => setTargetMode({ type: "nine", card, fromSeven, targets: nineTargets(s, me) })}
            />
          );
        else
          opts.push(
            <Btn
              key="oo"
              title={`One-off: ${ONE_OFF_DESC[r]}`}
              onPress={() => commit((g) => actOneOff(g, me, card, null, fromSeven))}
            />
          );
      }
    }
    if (r === 11 && jackTargets(s, me).length > 0)
      opts.push(
        <Btn
          key="jk"
          title="Steal a point card…"
          onPress={() => setTargetMode({ type: "jack", card, fromSeven, targets: jackTargets(s, me) })}
        />
      );
    const jackBlocked = r === 11 && queensOf(s, opp).length > 0;
    if (r === 12 || r === 13)
      opts.push(
        <Btn
          key="ry"
          title={`Play as Royal (${r === 12 ? "Queen: protects your cards" : "King: lowers your goal"})`}
          onPress={() => commit((g) => actRoyal(g, me, card, false, fromSeven))}
        />
      );
    if (r === 8)
      opts.push(
        <Btn
          key="gl"
          title="Play as Glasses 👓 (reveal their hand)"
          onPress={() => commit((g) => actRoyal(g, me, card, true, fromSeven))}
        />
      );
    const noPlay = opts.length === 0;
    return (
      <View style={styles.actions}>
        <Text style={{ color: colors.text, marginBottom: 4 }}>
          <Text style={{ fontWeight: "700" }}>{cardName(card)}</Text>
          {fromSeven ? " — you must play this card now:" : " — choose an action:"}
        </Text>
        <View style={styles.arow}>
          {opts}
          {jackBlocked && (
            <Hint>Jack is blocked — {s.names[opp]} has a Queen.</Hint>
          )}
          {fromSeven && noPlay && (
            <Btn
              kind="warn"
              title="No legal play — discard it"
              onPress={() => commit((g) => actSevenDiscard(g, me))}
            />
          )}
          {!fromSeven && (
            <Btn
              small
              title="Cancel"
              onPress={() => {
                setSelCard(null);
                setTargetMode(null);
              }}
            />
          )}
        </View>
        {targetMode && (
          <View style={[styles.arow, { marginTop: 8, alignItems: "center" }]}>
            <Hint>👉 Tap a highlighted card on the table</Hint>
            <Btn small title="cancel target" onPress={() => setTargetMode(null)} />
          </View>
        )}
      </View>
    );
  };

  const Field = ({ p }: { p: PlayerId }) => (
    <>
      <RowLabel>Royals</RowLabel>
      <View style={styles.cardrow}>
        {s.royals[p].length === 0 && <Hint>—</Hint>}
        {s.royals[p].map((r, i) => (
          <View key={i} style={r.g ? { marginHorizontal: 12 } : undefined}>
            <CardView
              id={r.c}
              glasses={r.g}
              target={isTgt("royal", p, i)}
              onPress={isTgt("royal", p, i) ? () => clickTarget("royal", p, i) : undefined}
            />
          </View>
        ))}
      </View>
      <RowLabel>
        Point cards {p === me ? `(you: ${pointsOf(s, p)}/${goalOf(s, p)})` : `(${pointsOf(s, p)}/${goalOf(s, p)})`}
      </RowLabel>
      <View style={styles.cardrow}>
        {s.points[p].length === 0 && <Hint>—</Hint>}
        {s.points[p].map((st, i) => {
          const jackT = isTgt("jack", p, i);
          const pointT = isTgt("point", p, i);
          return (
            <View key={i} style={{ position: "relative" }}>
              <CardView
                id={st.c}
                target={pointT || jackT}
                onPress={
                  pointT
                    ? () => clickTarget("point", p, i)
                    : jackT
                      ? () => clickTarget("jack", p, i)
                      : undefined
                }
              />
              {st.jacks.length > 0 && (
                <View style={styles.jackChips} pointerEvents="none">
                  {st.jacks.map((j, k) => (
                    <View key={k} style={[styles.jackChip, jackT && { borderColor: colors.coral }]}>
                      <Text style={styles.jackChipText}>J{SUITS[suitOf(j)]}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </>
  );

  const winnerCanRematch = s.winner === "draw" ? me === "p1" : s.winner === me;

  return (
    <View style={{ flex: 1, backgroundColor: colors.sea2 }}>
      <ScrollView contentContainerStyle={styles.wrap}>
        {/* Top bar */}
        <View style={styles.topbar}>
          <Text style={styles.title}>
            🦑 Cuttle <Text style={{ color: colors.gold }}>Online</Text>
          </Text>
          <View style={styles.topBtns}>
            <View style={styles.pill}>
              <Text style={{ color: colors.text, fontSize: 13 }}>
                Room <Text style={{ color: colors.gold, letterSpacing: 2, fontWeight: "700" }}>{code}</Text>
              </Text>
            </View>
            <Btn small title="Rules" onPress={() => setShowRules(true)} />
            <Btn small title={`Scrap (${s.scrap.length})`} onPress={() => setShowScrap(true)} />
            <Btn small title="Leave" onPress={onLeave} />
          </View>
        </View>

        {waitingForP2 && (
          <Notice>
            Share the room code {code} with your friend. They enter their name and the code and
            hit Join. This screen updates automatically when they arrive.
          </Notice>
        )}

        {/* Opponent zone */}
        <View style={styles.zone}>
          <View style={styles.zonehead}>
            <Text style={styles.pname}>
              {s.names[opp] || "Waiting…"}
              {s.turn === opp && s.phase !== "over" ? " · their turn" : ""}
            </Text>
            <Text style={styles.pts}>
              {pointsOf(s, opp)} / {goalOf(s, opp)} pts · {kingsOf(s, opp)}♚ · {s.hands[opp].length} in hand
            </Text>
          </View>
          <RowLabel>Hand</RowLabel>
          <View style={styles.cardrow}>
            {s.hands[opp].map((c, i) =>
              iSeeOppHand ? <CardView key={i} id={c} small /> : <CardView key={i} back small />
            )}
            {s.hands[opp].length === 0 && <Hint>empty</Hint>}
          </View>
          <Field p={opp} />
        </View>

        {/* Center strip */}
        <View style={styles.center}>
          <View style={styles.deckbox}>
            <CardView back small />
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>
                Deck: <Text style={{ fontWeight: "700" }}>{s.deck.length}</Text>
              </Text>
              <Btn
                small
                title={s.deck.length === 0 ? "Pass" : "Draw"}
                disabled={!myTurn || busy}
                onPress={() => commit((g) => actDraw(g, me))}
              />
            </View>
          </View>
          <View
            style={[
              styles.turnbanner,
              (myTurn || counterMine || discardMine || scrapPickMine || sevenMine) && styles.turnbannerYou,
            ]}
          >
            <Text
              style={{
                color:
                  myTurn || counterMine || discardMine || scrapPickMine || sevenMine
                    ? colors.gold
                    : colors.text,
                fontSize: 14,
              }}
            >
              {banner}
            </Text>
          </View>
        </View>

        {/* Game over — win message + rematch, kept in the middle by the banner */}
        {s.phase === "over" && (
          <View style={styles.gameover}>
            <Text style={{ color: colors.gold, fontSize: 20, fontWeight: "700" }}>
              {s.winner === "draw" ? "Draw game!" : `${s.names[s.winner as PlayerId]} wins! 🏆`}
            </Text>
            {winnerCanRematch ? (
              <Btn
                kind="primary"
                title="Rematch"
                disabled={busy}
                onPress={() => commit((g) => actRematch(g, me))}
              />
            ) : (
              <Hint>
                Waiting for {s.winner === "draw" ? s.names.p1 : s.names[s.winner as PlayerId]} to
                start the rematch…
              </Hint>
            )}
          </View>
        )}

        {/* Seven panel */}
        {sevenMine && s.sevenCard != null && (
          <View style={[styles.actions, { borderColor: colors.gold }]}>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 6 }}>
              <CardView id={s.sevenCard} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontWeight: "700" }}>Revealed by your Seven.</Text>
                <Hint>You must play this card immediately if possible.</Hint>
              </View>
            </View>
            <ActionMenu card={s.sevenCard} fromSeven />
          </View>
        )}

        {/* My zone */}
        <View style={[styles.zone, { borderColor: colors.mineBorder }]}>
          <View style={styles.zonehead}>
            <Text style={styles.pname}>
              {s.names[me]} (you){myTurn ? " · your turn" : ""}
            </Text>
            <Text style={styles.pts}>
              {pointsOf(s, me)} / {goalOf(s, me)} pts · {kingsOf(s, me)}♚
            </Text>
          </View>
          <Field p={me} />
          <RowLabel>Your hand</RowLabel>
          <View style={styles.cardrow}>
            {s.hands[me].map((c, i) => (
              <CardView
                key={i}
                id={c}
                sel={selCard === c}
                onPress={
                  myTurn && !targetMode ? () => setSelCard(selCard === c ? null : c) : undefined
                }
              />
            ))}
            {s.hands[me].length === 0 && <Hint>empty</Hint>}
          </View>
        </View>

        {myTurn && selCard != null && !sevenMine && <ActionMenu card={selCard} />}

        {oppGlassesOnMe && (
          <Notice>👓 {s.names[opp]} has Glasses in play — your hand is revealed to them!</Notice>
        )}

        {/* Log */}
        <View style={styles.log}>
          {s.log
            .slice(-30)
            .reverse()
            .map((l, i) => (
              <Text key={i} style={styles.logLine}>
                {l}
              </Text>
            ))}
        </View>
      </ScrollView>

      {/* Counter modal */}
      <Sheet visible={counterMine && !!s.pending} title="One-off incoming!">
        {s.pending && (
          <>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <CardView id={s.pending.c} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }}>
                  <Text style={{ fontWeight: "700" }}>{s.names[s.pending.by]}</Text> played{" "}
                  <Text style={{ fontWeight: "700" }}>{cardName(s.pending.c)}</Text>:
                </Text>
                <Hint>{ONE_OFF_DESC[rankOf(s.pending.c)]}</Hint>
                {s.pending.counters.length > 0 && (
                  <Hint style={{ marginTop: 4 }}>
                    Counter chain: {s.pending.counters.map((x) => cardName(x.c)).join(" ← ")}{" "}
                    {s.pending.counters.length % 2 === 1 ? "(currently countered)" : "(currently resolving)"}
                  </Hint>
                )}
              </View>
            </View>
            <View style={styles.arow}>
              {myTwos.map((c) => (
                <Btn
                  key={c}
                  kind="warn"
                  title={`Counter with ${cardName(c)}`}
                  disabled={busy}
                  onPress={() => commit((g) => playCounterTwo(g, me, c))}
                />
              ))}
              <Btn
                kind="primary"
                title="Let it resolve"
                disabled={busy}
                onPress={() => commit((g) => declineCounter(g, me))}
              />
            </View>
          </>
        )}
      </Sheet>

      {/* Discard modal (Four) */}
      <Sheet visible={discardMine} title={`Discard ${s.discardNeed} card${s.discardNeed > 1 ? "s" : ""}`}>
        <Hint>
          A Four resolved against you. Choose {s.discardNeed} card{s.discardNeed > 1 ? "s" : ""} to scrap.
        </Hint>
        <View style={[styles.cardrow, { marginVertical: 10 }]}>
          {s.hands[me].map((c, i) => (
            <CardView
              key={i}
              id={c}
              sel={discardSel.includes(c)}
              onPress={() =>
                setDiscardSel((d) =>
                  d.includes(c) ? d.filter((x) => x !== c) : d.length < s.discardNeed ? [...d, c] : d
                )
              }
            />
          ))}
        </View>
        <Btn
          kind="primary"
          title="Discard selected"
          disabled={discardSel.length !== s.discardNeed || busy}
          // Don't clear the selection up front — if the commit fails the
          // selection stays put so the button remains usable for a retry.
          // The snapshot listener clears discardSel once the move lands.
          onPress={() => commit((g) => actDiscardDone(g, me, discardSel))}
        />
      </Sheet>

      {/* Scrap pick modal (Three) */}
      <Sheet visible={scrapPickMine} title="Rummage the scrap pile">
        <Hint>Take one card into your hand.</Hint>
        <View style={[styles.cardrow, { marginVertical: 10 }]}>
          {s.scrap.map((c, i) => (
            <CardView key={i} id={c} onPress={() => commit((g) => actScrapPick(g, me, c))} />
          ))}
        </View>
      </Sheet>

      {/* Scrap viewer */}
      <Sheet visible={showScrap} onClose={() => setShowScrap(false)} title={`Scrap pile (${s.scrap.length})`}>
        <Hint>Face up and public. Cards here don't affect the game.</Hint>
        <View style={[styles.cardrow, { marginVertical: 10 }]}>
          {s.scrap.length === 0 && <Hint>empty</Hint>}
          {s.scrap.map((c, i) => (
            <CardView key={i} id={c} small />
          ))}
        </View>
        <Btn title="Close" onPress={() => setShowScrap(false)} />
      </Sheet>

      {/* Rules */}
      <Sheet visible={showRules} onClose={() => setShowRules(false)} title="Quick rules">
        <Text style={styles.rulesText}>
          <Text style={{ fontWeight: "700" }}>Goal:</Text> end your turn with point cards worth 21+
          (less with Kings: 14 / 10 / 7 / 5).{"\n\n"}
          <Text style={{ fontWeight: "700" }}>On your turn:</Text> draw a card, or play one card —
          as points (A–10), as a scuttle, as a one-off, or as a Royal/Glasses.{"\n\n"}
          <Text style={{ fontWeight: "700" }}>Scuttle:</Text> an A–10 from your hand destroys an
          opponent's lower point card (rank first, then suit ♣&lt;♦&lt;♥&lt;♠). Both go to scrap.
          {"\n\n"}
          <Text style={{ fontWeight: "700" }}>One-offs</Text> (card goes to scrap): A = scrap all
          points · 2 = scrap a Royal/Jack, or counter a one-off (playable anytime!) · 3 = take from
          scrap · 4 = opponent discards 2 · 5 = draw 2 · 6 = scrap all Royals/Jacks · 7 = draw &
          play immediately · 9 = put a permanent on top of the draw pile (house rule).{"\n\n"}
          <Text style={{ fontWeight: "700" }}>Royals:</Text> Jack steals a point card · Queen
          protects your other cards from Jacks, 2s and 9s (not scuttles or Aces/Sixes) · King
          lowers your goal · 8 can be played sideways as Glasses to reveal the opponent's hand.
          {"\n\n"}
          <Text style={{ fontWeight: "700" }}>Empty deck:</Text> drawing becomes a pass; three
          passes in a row is a draw.
        </Text>
        <Btn title="Close" onPress={() => setShowRules(false)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 12, paddingTop: 54, paddingBottom: 24, maxWidth: 900, width: "100%", alignSelf: "center" },
  loading: {
    flex: 1,
    backgroundColor: colors.sea2,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  topbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  title: { fontSize: 22, color: colors.teal, fontWeight: "700" },
  topBtns: { flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" },
  pill: {
    backgroundColor: colors.sea3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  zone: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  zonehead: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 6,
  },
  pname: { fontWeight: "600", fontSize: 15, color: "#fff" },
  pts: { fontSize: 13, color: colors.gold },
  cardrow: { flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 14, alignItems: "center" },
  jackChips: { position: "absolute", top: -8, right: -8, gap: 2 },
  jackChip: {
    backgroundColor: colors.jackBg,
    borderColor: colors.jackBorder,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  jackChipText: { color: colors.jackText, fontSize: 10, fontWeight: "700" },
  center: { flexDirection: "row", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  deckbox: {
    backgroundColor: colors.sea3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  turnbanner: {
    flex: 1,
    minWidth: 200,
    backgroundColor: colors.sea3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  turnbannerYou: { borderColor: colors.gold },
  gameover: {
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 12,
    backgroundColor: colors.sea3,
  },
  actions: {
    backgroundColor: colors.actionBg,
    borderColor: colors.actionBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  arow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  log: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxHeight: 160,
    overflow: "hidden",
  },
  logLine: { fontSize: 12.5, color: "#b9d4d0", paddingVertical: 1.5 },
  rulesText: { fontSize: 13.5, lineHeight: 21, color: colors.text, marginBottom: 12 },
});
