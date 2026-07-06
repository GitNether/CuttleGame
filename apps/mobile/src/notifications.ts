import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// "It's your turn" push notifications.
//
// There is no server, so the player who just moved sends the push to the
// opponent's Expo push token (stored in the room document) via Expo's public
// push API. Everything here degrades gracefully: if permissions are denied,
// the device is an emulator, or the EAS projectId / FCM credentials aren't set
// up yet, registration simply returns null and the game plays on without push.

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/** Show a banner + play a sound even when the app is foregrounded. Call once
 *  at startup. */
export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function projectId(): string | undefined {
  const id = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  // Ignore the scaffold placeholder so getExpoPushTokenAsync isn't called
  // with a bogus id.
  if (!id || id === "REPLACE_WITH_EAS_PROJECT_ID") return undefined;
  return id;
}

/** Requests permission and returns this device's Expo push token, or null if
 *  push can't be set up (denied, emulator, missing projectId/FCM). Never throws. */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null; // push doesn't work on simulators

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("turn", {
        name: "Your turn",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const pid = projectId();
    if (!pid) return null; // needs a real EAS projectId (see STORE_CHECKLIST)

    const token = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    return token.data;
  } catch {
    return null;
  }
}

/** Best-effort "your turn" push to the opponent. Fire-and-forget; failures are
 *  swallowed so a push hiccup never blocks the game. */
export async function sendTurnNotification(
  toToken: string,
  roomCode: string,
  fromName: string
): Promise<void> {
  try {
    await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: toToken,
        title: "Cuttle — your turn",
        body: `It's your move against ${fromName} (room ${roomCode}).`,
        sound: "default",
        priority: "high",
        channelId: "turn",
        data: { roomCode },
      }),
    });
  } catch {
    // ignore — push is a nicety, not part of game state
  }
}
