import { other, type GameState, type PlayerId } from "@cuttle/engine";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";
import { Btn, Hint } from "../components/ui";
import { GameBoard } from "../game/GameBoard";
import { sendTurnNotification } from "../notifications";
import { commitMove, refreshSeatPushToken, subscribeRoom, whoActsNext, type RoomDoc } from "../sync";
import { colors } from "../theme";

interface Props {
  code: string;
  seat: PlayerId;
  pushToken: string | null;
  onLeave: () => void;
}

/** Online game: Firebase-backed state + move commits, rendered by GameBoard. */
export function GameScreen({ code, seat, pushToken, onLeave }: Props) {
  const [room, setRoom] = useState<RoomDoc | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const unsub = subscribeRoom(code, setRoom);
    // Firestore resumes the stream on foreground automatically; nothing else
    // needed, but keep an AppState hook as a future extension point.
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
        // A Firestore transaction can hang on a flaky connection; race a
        // timeout so busy can never stick true and dead-lock the UI. The
        // version check makes a late write harmless.
        const result = await Promise.race([
          commitMove(code, base.version, mutator),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("commit-timeout")), 15000)),
        ]);
        const opponent = other(seat);
        if (whoActsNext(result.state) === opponent) {
          const token = result.players[opponent]?.pushToken;
          if (token) void sendTurnNotification(token, code, result.state.names[seat]);
        }
      } catch {
        // stale / rejected / timeout — the snapshot listener holds the truth.
      } finally {
        setBusy(false);
      }
    },
    [code, busy, seat]
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

  return (
    <GameBoard
      state={room.state}
      me={seat}
      stateKey={room.version}
      busy={busy}
      commit={commit}
      onLeave={onLeave}
      roomCode={code}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.sea2,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
