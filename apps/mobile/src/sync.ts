import {
  actJoinAsP2,
  clone,
  newGame,
  type GameState,
  type PlayerId,
} from "@cuttle/engine";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export interface SeatInfo {
  uid: string;
  name: string;
  /** Expo push token for "your turn" notifications; omitted if push isn't set
   *  up on that device. */
  pushToken?: string;
}

export interface RoomDoc {
  version: number;
  state: GameState;
  players: { p1: SeatInfo; p2: SeatInfo | null };
}

export type SyncErrorCode =
  | "not-found" // no room with that code
  | "room-full" // both seats taken by other names
  | "stale" // our base version was outdated; a newer snapshot is coming
  | "rejected" // the engine guard refused the move (double tap / race)
  | "code-space"; // couldn't find a free room code (astronomically unlikely)

export class SyncError extends Error {
  constructor(public code: SyncErrorCode) {
    super(code);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, no O — legacy alphabet
const LOG_CAP = 100;
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, refreshed on every write

const roomRef = (code: string): DocumentReference => doc(db, "rooms", code);

const randomCode = () =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

const expiry = () => Timestamp.fromMillis(Date.now() + ROOM_TTL_MS);

function writePayload(version: number, state: GameState) {
  state.log = state.log.slice(-LOG_CAP); // keep the doc far below the 1 MB limit
  return { version, state, updatedAt: serverTimestamp(), expiresAt: expiry() };
}

/** Firestore rejects `undefined`, so only include pushToken when we have one. */
function makeSeat(uid: string, name: string, pushToken?: string | null): SeatInfo {
  return pushToken ? { uid, name, pushToken } : { uid, name };
}

/** Creates a room with a fresh 4-letter code. The deal happens inside the
 *  transaction body but is only committed once — and code collisions retry
 *  with a new code. */
export async function createRoom(
  name: string,
  pushToken?: string | null
): Promise<{ code: string; seat: PlayerId }> {
  const uid = auth.currentUser!.uid;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode();
    const created = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (snap.exists()) return false; // collision — try another code
      const state = newGame({ p1: name, p2: "" }, "p1");
      tx.set(roomRef(code), {
        ...writePayload(1, state),
        players: { p1: makeSeat(uid, name, pushToken), p2: null },
        createdAt: serverTimestamp(),
      });
      return true;
    });
    if (created) return { code, seat: "p1" };
  }
  throw new SyncError("code-space");
}

/** Joins a room: claims the empty p2 seat, or rejoins a seat whose name
 *  matches (rebinding that seat's uid — covers reinstalled apps whose
 *  anonymous auth uid changed). Also refreshes the seat's push token. */
export async function joinRoom(
  code: string,
  name: string,
  pushToken?: string | null
): Promise<{ seat: PlayerId }> {
  const uid = auth.currentUser!.uid;
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new SyncError("not-found");
    const room = snap.data() as RoomDoc;

    // Rejoin an existing seat by name (uid match or name match).
    for (const seat of ["p1", "p2"] as PlayerId[]) {
      const si = room.players[seat];
      if (si && (si.uid === uid || si.name === name)) {
        const token = pushToken ?? si.pushToken;
        const rebind = si.uid !== uid || si.name !== name;
        const tokenChanged = (si.pushToken ?? null) !== (token ?? null);
        if (rebind || tokenChanged) {
          tx.update(roomRef(code), {
            [`players.${seat}`]: makeSeat(uid, si.name, token),
            version: room.version + 1,
            updatedAt: serverTimestamp(),
            expiresAt: expiry(),
          });
        }
        return { seat };
      }
    }

    // Claim the empty seat.
    if (!room.players.p2) {
      const state = clone(room.state);
      if (!actJoinAsP2(state, name)) throw new SyncError("room-full");
      tx.update(roomRef(code), {
        ...writePayload(room.version + 1, state),
        "players.p2": makeSeat(uid, name, pushToken),
      });
      return { seat: "p2" };
    }

    throw new SyncError("room-full");
  });
}

/** Applies an engine mutation atomically. The mutator runs INSIDE the
 *  transaction against the freshly read state — never against React state —
 *  so it executes effectively once per committed action even if Firestore
 *  retries the closure, and a slow write can never overwrite a newer state
 *  (the version check turns it into a clean "stale" failure instead). */
export async function commitMove(
  code: string,
  baseVersion: number,
  mutator: (s: GameState) => boolean
): Promise<{ state: GameState; players: RoomDoc["players"] }> {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef(code));
    if (!snap.exists()) throw new SyncError("not-found");
    const room = snap.data() as RoomDoc;
    if (room.version !== baseVersion) throw new SyncError("stale");
    const state = clone(room.state);
    if (!mutator(state)) throw new SyncError("rejected");
    tx.update(roomRef(code), writePayload(room.version + 1, state));
    return { state, players: room.players };
  });
}

/** Ensure the current player's seat carries this push token. Handles the case
 *  where the token only resolves (after the OS permission prompt) once the
 *  player is already in a room, so create/join couldn't store it. No-op when
 *  the token already matches or the player isn't seated here. */
export async function refreshSeatPushToken(code: string, token: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid || !token) return;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (!snap.exists()) return;
      const room = snap.data() as RoomDoc;
      const seat = (["p1", "p2"] as PlayerId[]).find((p) => room.players[p]?.uid === uid);
      if (!seat) return;
      const si = room.players[seat]!;
      if (si.pushToken === token) return; // already stored
      tx.update(roomRef(code), {
        [`players.${seat}`]: makeSeat(uid, si.name, token),
        version: room.version + 1,
        updatedAt: serverTimestamp(),
        expiresAt: expiry(),
      });
    });
  } catch {
    // best-effort — push is a nicety, never block the game
  }
}

/** Which player, if any, must act in this state — used to decide who to ping
 *  with a "your turn" notification. */
export function whoActsNext(s: GameState): PlayerId | null {
  if (s.phase === "play") return s.turn;
  if (s.phase === "counter" || s.phase === "discard" || s.phase === "scrap_pick" || s.phase === "seven")
    return s.actor;
  return null; // waiting / over
}

/** Best-effort cleanup of a room that has passed its expiry (7 days after
 *  the last move). Called opportunistically when the device moves on from an
 *  old room — this replaces Firestore's TTL feature, which needs billing
 *  enabled. The security rules only permit deleting expired rooms, so a
 *  clock-skewed or malicious client can never delete a live game. */
export async function deleteRoomIfExpired(code: string): Promise<void> {
  try {
    const snap = await getDoc(roomRef(code));
    if (!snap.exists()) return;
    const expiresAt = snap.get("expiresAt") as Timestamp | undefined;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      await deleteDoc(roomRef(code));
    }
  } catch {
    // cleanup is optional — never let it break the flow that triggered it
  }
}

/** Realtime subscription with automatic resubscribe on listener errors.
 *  Firestore already retries transient network loss internally; the backoff
 *  here only covers hard listener failures. */
export function subscribeRoom(
  code: string,
  onDoc: (room: RoomDoc | null) => void
): () => void {
  let cancelled = false;
  let unsub: () => void = () => {};
  let retry: ReturnType<typeof setTimeout> | undefined;

  const attach = () => {
    if (cancelled) return;
    unsub = onSnapshot(
      roomRef(code),
      (snap) => onDoc(snap.exists() ? (snap.data() as RoomDoc) : null),
      () => {
        unsub();
        retry = setTimeout(attach, 2000);
      }
    );
  };
  attach();

  return () => {
    cancelled = true;
    if (retry) clearTimeout(retry);
    unsub();
  };
}
