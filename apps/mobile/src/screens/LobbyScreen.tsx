import type { PlayerId } from "@cuttle/engine";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SyncError, createRoom, deleteRoomIfExpired, joinRoom } from "../sync";
import { saveSession, type SavedSession } from "../session";
import { colors } from "../theme";
import { Btn, Hint, RowLabel } from "../components/ui";

interface Props {
  initialName: string;
  resumable: SavedSession | null;
  pushToken: string | null;
  onEnterRoom: (code: string, seat: PlayerId, name: string) => void;
  onDiscardResume: () => void;
}

export function LobbyScreen({
  initialName,
  resumable,
  pushToken,
  onEnterRoom,
  onDiscardResume,
}: Props) {
  const [name, setName] = useState(initialName);
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const friendlyError = (e: unknown): string => {
    if (e instanceof SyncError) {
      if (e.code === "not-found")
        return "No game found with that code. Check the code with your friend.";
      if (e.code === "room-full")
        return "This room already has two players. Enter one of their names exactly to rejoin.";
    }
    return "Couldn't reach the server — check your connection and try again.";
  };

  /** Leaving an old room behind? Tidy it up if it has expired. */
  const cleanupOldRoom = (newCode: string) => {
    if (resumable && resumable.code !== newCode) void deleteRoomIfExpired(resumable.code);
  };

  const create = async () => {
    if (!name.trim()) return setErr("Enter your name first.");
    setBusy(true);
    setErr("");
    try {
      const { code, seat } = await createRoom(name.trim(), pushToken);
      cleanupOldRoom(code);
      await saveSession({ code, seat, name: name.trim() });
      onEnterRoom(code, seat, name.trim());
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!name.trim()) return setErr("Enter your name first.");
    const code = joinCode.trim().toUpperCase();
    if (code.length < 3) return setErr("Enter the room code your friend gave you.");
    setBusy(true);
    setErr("");
    try {
      const { seat } = await joinRoom(code, name.trim(), pushToken);
      cleanupOldRoom(code);
      await saveSession({ code, seat, name: name.trim() });
      onEnterRoom(code, seat, name.trim());
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!resumable) return;
    setBusy(true);
    setErr("");
    try {
      // Re-run the join flow so a reinstalled device rebinds its uid.
      const { seat } = await joinRoom(resumable.code, resumable.name, pushToken);
      onEnterRoom(resumable.code, seat, resumable.name);
    } catch (e) {
      setErr(friendlyError(e));
      onDiscardResume();
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.sea2 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>
            🦑 Cuttle <Text style={{ color: colors.gold }}>Online</Text>
          </Text>
          <Hint style={{ textAlign: "center", marginTop: 4 }}>
            The 1975 combat card game — play with a friend over the internet.
          </Hint>

          {resumable && (
            <View style={styles.resumeBox}>
              <Text style={{ color: colors.text, fontSize: 14, marginBottom: 8 }}>
                You have a game in room{" "}
                <Text style={{ color: colors.gold, letterSpacing: 2, fontWeight: "700" }}>
                  {resumable.code}
                </Text>{" "}
                as {resumable.name}.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Btn title="Resume game" kind="primary" onPress={resume} disabled={busy} />
                <Btn
                  title="Forget it"
                  small
                  disabled={busy}
                  onPress={() => {
                    void deleteRoomIfExpired(resumable.code);
                    onDiscardResume();
                  }}
                />
              </View>
            </View>
          )}

          <RowLabel>Your name</RowLabel>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Nether"
            placeholderTextColor={colors.label}
            maxLength={16}
          />

          <Btn
            title="Create a new game"
            kind="primary"
            onPress={create}
            disabled={busy}
            style={{ marginTop: 16 }}
          />

          <Text style={styles.divider}>— or join a friend's game —</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[styles.input, styles.codeInput]}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              placeholder="CODE"
              placeholderTextColor={colors.label}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
            />
            <Btn title="Join" onPress={join} disabled={busy} />
          </View>

          {err ? <Text style={styles.error}>{err}</Text> : null}
          <Hint style={{ marginTop: 16, fontSize: 12 }}>
            Room codes never contain the letters I or O. Rooms expire 7 days after the last
            move.
          </Hint>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", padding: 16 },
  card: {
    maxWidth: 430,
    width: "100%",
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 22,
  },
  title: { fontSize: 32, color: colors.teal, textAlign: "center", fontWeight: "700" },
  input: {
    backgroundColor: "#0d2f3b",
    borderColor: colors.line,
    borderWidth: 1,
    color: "#eaf6f4",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    flexGrow: 1,
  },
  codeInput: { letterSpacing: 3, flex: 1 },
  divider: { textAlign: "center", marginVertical: 14, color: colors.label, fontSize: 13 },
  error: { color: colors.error, fontSize: 13, marginTop: 8 },
  resumeBox: {
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: colors.sea3,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
});
