import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlayerId } from "@cuttle/engine";

/** What we persist on-device so the app can rejoin after a restart. */
export interface SavedSession {
  code: string;
  seat: PlayerId;
  name: string;
}

const KEY = "cuttle.session";
const NAME_KEY = "cuttle.playerName";

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedSession;
    return s.code && s.seat && s.name ? s : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: SavedSession): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(s));
  await AsyncStorage.setItem(NAME_KEY, s.name);
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

export async function loadPlayerName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NAME_KEY)) ?? "";
  } catch {
    return "";
  }
}
