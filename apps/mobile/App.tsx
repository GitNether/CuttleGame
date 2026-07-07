import type { PlayerId } from "@cuttle/engine";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Btn, Hint } from "./src/components/ui";
import { ensureSignedIn } from "./src/firebase";
import { configureNotifications, registerForPushNotificationsAsync } from "./src/notifications";
import { clearSession, loadPlayerName, loadSession, type SavedSession } from "./src/session";
import { GameScreen } from "./src/screens/GameScreen";
import { OfflineGameScreen } from "./src/screens/OfflineGameScreen";
import { LobbyScreen } from "./src/screens/LobbyScreen";
import { colors } from "./src/theme";

configureNotifications(); // how notifications render while the app is open

type Screen =
  | { kind: "boot" }
  | { kind: "auth-error" }
  | { kind: "lobby" }
  | { kind: "game"; code: string; seat: PlayerId }
  | { kind: "offline" };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "boot" });
  const [savedName, setSavedName] = useState("");
  const [resumable, setResumable] = useState<SavedSession | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0); // bump to retry sign-in

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await ensureSignedIn();
        const [session, name] = await Promise.all([loadSession(), loadPlayerName()]);
        if (!alive) return;
        setSavedName(name);
        setResumable(session);
        setScreen({ kind: "lobby" });
      } catch {
        if (alive) setScreen({ kind: "auth-error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [authTick]);

  // Ask for notification permission and fetch this device's push token once,
  // in the background. Never blocks the UI — stays null if push isn't set up.
  useEffect(() => {
    let alive = true;
    registerForPushNotificationsAsync().then((t) => {
      if (alive) setPushToken(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {screen.kind === "boot" && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.teal} />
        </View>
      )}
      {screen.kind === "auth-error" && (
        <View style={styles.centered}>
          <Text style={{ color: colors.text, fontSize: 16, marginBottom: 6 }}>
            Couldn't connect.
          </Text>
          <Hint style={{ textAlign: "center", marginBottom: 12 }}>
            Check your internet connection — the game needs it to reach your friend.
          </Hint>
          <Btn
            title="Try again"
            kind="primary"
            onPress={() => {
              setScreen({ kind: "boot" });
              setAuthTick((t) => t + 1);
            }}
          />
          <Btn
            title="Play vs Computer 🤖"
            onPress={() => setScreen({ kind: "offline" })}
            style={{ marginTop: 10 }}
          />
        </View>
      )}
      {screen.kind === "lobby" && (
        <LobbyScreen
          initialName={savedName}
          resumable={resumable}
          pushToken={pushToken}
          onEnterRoom={(code, seat, name) => {
            setSavedName(name);
            setResumable({ code, seat, name });
            setScreen({ kind: "game", code, seat });
          }}
          onDiscardResume={() => {
            setResumable(null);
            clearSession();
          }}
          onPlayOffline={() => setScreen({ kind: "offline" })}
        />
      )}
      {screen.kind === "offline" && (
        <OfflineGameScreen name={savedName} onLeave={() => setScreen({ kind: "lobby" })} />
      )}
      {screen.kind === "game" && (
        <GameScreen
          code={screen.code}
          seat={screen.seat}
          pushToken={pushToken}
          onLeave={() => setScreen({ kind: "lobby" })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.sea2 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
