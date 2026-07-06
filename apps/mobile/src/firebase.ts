import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import { initializeAuth, signInAnonymously, type Persistence, type User } from "firebase/auth";
// getReactNativePersistence lives in the react-native build of firebase/auth,
// which Metro selects at runtime; the published browser types don't declare
// it, hence the manual typing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getReactNativePersistence } = require("firebase/auth") as {
  getReactNativePersistence: (storage: unknown) => Persistence;
};
import { initializeFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);

// AsyncStorage persistence keeps the anonymous UID across app restarts,
// so a device stays "the same player" for the security rules.
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// React Native has no streaming fetch; force long polling for Firestore's
// realtime listeners to work reliably on device networks.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

/** Resolves once we have an anonymous user (creating one if needed). */
export function ensureSignedIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    const unsub = auth.onAuthStateChanged((user) => {
      if (user) {
        unsub();
        resolve(user);
      } else {
        signInAnonymously(auth).catch((e) => {
          unsub();
          reject(e);
        });
      }
    }, reject);
  });
}
