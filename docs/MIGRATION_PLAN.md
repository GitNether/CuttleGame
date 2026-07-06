# Cuttle Online → Native Mobile App: Migration Plan

Source of truth: `legacy/cuttle-online.jsx` — the battle-tested single-file React web
implementation (artifact key-value storage + 2 s polling). This plan describes how it
becomes an Expo (React Native) app with Firebase real-time sync.

## 1. Architecture overview

```
CuttleGame/
├── packages/engine/     Pure TypeScript game engine, zero dependencies, unit-tested.
│                        Ported line-for-line from the legacy actions/resolution code.
├── apps/mobile/         Expo app (iOS + Android). UI port of the legacy screens,
│                        deep-sea theme, Firebase sync layer, room persistence.
├── firebase/            Firestore security rules + deploy notes.
├── docs/                This plan + store-submission checklist.
└── legacy/              The original artifact file, kept for reference/diffing.
```

Three layers, strictly separated:

1. **Engine** (`packages/engine`) — pure functions over a `GameState` value. No React,
   no Firebase, no timers, no `Math.random` calls hidden in the module (RNG is injected
   into `newDeck`/`newGame` and defaults to `Math.random`). This is the part that must
   never regress, so it is ported faithfully — same state shape, same guards, same log
   strings — and covered by unit tests.
2. **Sync** (`apps/mobile/src/sync.ts`) — room documents in Firestore, real-time
   `onSnapshot` listeners, and a `commit(mutator)` primitive built on Firestore
   transactions with a version check.
3. **UI** (`apps/mobile/src/screens`, `components`) — React Native port of the legacy
   JSX, mobile-first with the same deep-sea palette.

Authoritative resolution stays on the acting player's client (no server logic in v1),
exactly as today. Because the engine is a pure module with a single
`applyAction(state, action)` entry point, adding server-side validation later is a
Cloud Function that imports the same package and replays the action — no engine change.

## 2. Firebase choice: **Cloud Firestore** (not Realtime Database)

| Concern | Firestore | RTDB | Why it matters here |
|---|---|---|---|
| Write ordering | `runTransaction` with read-modify-write and automatic retry | transactions exist but are per-node with local-cache quirks | Lesson #3: a version-checked transaction is the clean replacement for the legacy monotonic version + nonce tiebreaker |
| Data model | 1 room = 1 document | 1 room = 1 subtree | Whole game state (~10–20 KB with capped log) fits one doc; every move is one doc write, one listener event |
| Stale room cleanup | `expiresAt` marker + rules-gated client deletes (TTL policies exist but require billing) | needs a scheduled Cloud Function or client-side sweep | No paid services, no cron |
| EU region (GDPR) | `europe-west3` (Frankfurt) or `eur3` multi-region | `europe-west1` only | User is in Germany; Frankfurt keeps data in-country |
| Reconnect | `onSnapshot` has built-in offline cache, retry, and latency compensation | comparable | Both fine; Firestore's is fully automatic |
| Free tier | 50 k reads / 20 k writes per day | 1 GB stored / 10 GB transfer per month | A full game is ~100–200 writes; two friends playing daily won't scratch either, but Firestore's per-day quotas reset and can't strand you mid-month |
| Latency | ~100–300 ms | ~10–100 ms | Irrelevant for a turn-based card game |

RTDB's only real edge (latency, `onDisconnect` presence) doesn't matter for turn-based
play. Firestore wins on the two things the legacy code fought hardest: ordered writes
and room expiry.

## 3. Firestore schema

One collection, one document per room:

```
rooms/{code}                       code = 4 letters, no I/O (legacy alphabet)
{
  version:    number               // monotonic, +1 per action — transaction-checked
  state:      GameState            // the entire engine state (see packages/engine)
  players: {
    p1: { uid: string, name: string }
    p2: { uid: string, name: string } | null
  }
  createdAt:  serverTimestamp
  updatedAt:  serverTimestamp
  expiresAt:  timestamp            // now + 7 days, refreshed on every write; gates cleanup deletes
}
```

Notes:

- `state` is the engine's `GameState`, minus the legacy `v`/`nonce` fields — versioning
  moves up into the document where the transaction can see it. The engine state keeps
  `names` internally (the engine logs use them); `players` additionally binds seats to
  anonymous-auth UIDs for security rules and rejoin.
- The move log inside `state` is capped (last 100 entries) on every commit so the
  document can never grow toward the 1 MB limit.
- Hand privacy: both hands live in the shared doc, same as the legacy storage. That is
  accepted for v1 (friends playing together; the legacy app had the same property and a
  "Glasses" reveal is a rules feature anyway). The hardening path is Cloud Functions +
  per-player subdocuments; the engine's purity keeps that door open.

### Commit protocol (lesson #1 + #3)

```
commit(mutator):
  runTransaction(db, async tx => {
    doc = await tx.get(roomRef)
    if (doc.version !== localBaseVersion) throw StaleError   // snapshot listener will
                                                             // deliver the newer state
    next = clone(doc.state)
    if (!mutator(next)) throw GuardError                     // phase/turn guard refused
    tx.update(roomRef, { state: next, version: doc.version + 1,
                         updatedAt: serverTimestamp(), expiresAt: now + 30d })
  })
```

- The mutator runs **inside** the transaction closure, never inside a React state
  updater — Firestore may retry the closure on contention, but each retry re-reads and
  re-derives from the fresh document, so exactly one final result is ever committed
  (this is the property the rematch double-deal bug taught us to protect).
- Every engine action keeps its full guard set (phase / turn / card-existence), so a
  double-tap or a tap racing an incoming snapshot aborts harmlessly.
- A slow write can never clobber a newer state: the version check makes it fail instead.

### Security rules sketch (full rules in `firebase/firestore.rules`)

```
match /rooms/{code} {
  allow get:    if signedIn();
  allow list:   if false;                            // rooms are join-by-code only
  allow create: if signedIn()
                && creatorIsP1() && p2IsNull()
                && request.resource.data.version == 1
                && validShape();
  allow update: if signedIn()
                && versionIncrementsByOne()          // enforces the transaction protocol
                && (isSeatedPlayer() || isClaimingEmptySeat() || isNameRejoin())
                && validShape();
  allow delete: if signedIn()
                && expired();                        // only stale rooms are deletable
}
```

- `signedIn()` = anonymous Firebase Auth (no accounts, no personal data beyond a
  self-chosen display name).
- `isNameRejoin()` covers the legacy "rejoin by entering the same name" flow after an
  app reinstall (new anonymous UID): the update may rebind one seat's `uid` if the
  submitted `name` matches that seat and the game state is untouched.
- `allow list: if false` intentionally drops the legacy "Show open rooms" browser —
  it required enumerating every room, which is both a privacy leak and incompatible
  with join-by-code rules. Friends share the 4-letter code; create/join/rejoin/rematch
  all remain.

## 4. Engine port (`packages/engine`)

Faithful port, not a rewrite:

- Same card encoding (`id 0..51`, rank `id % 13 + 1`, suit `id / 13 | 0`, suit order
  ♣<♦<♥<♠, `cardPower = rank*4 + suit`).
- Same `GameState` shape (`phase`, `turn`, `actor`, `pending`, `sevenCard`,
  `discardNeed`, `deck`, `scrap`, `hands`, `points` stacks with `jacks[]` + `base`,
  `royals` with glasses flag, `passes`, `winner`, `log`).
- Same action functions with identical guard conditions, now typed and returning
  `boolean` (legacy returned `false` on guard failure / `undefined` on success).
- Target enumeration (`scuttleTargets`, `jackTargets`, `twoTargets`, `nineTargets`)
  moves from the legacy component body into the engine so UI and future server
  validation share one implementation.
- House rule kept: **9 one-off puts the permanent on top of the draw pile**.
- All hard-won behaviors preserved: LIFO 2-counter chains,
  auto-resolve when the responder holds no 2, six reverting stolen cards to `base`,
  seven→nested one-offs, empty-deck pass / three-pass draw, king goals 21/14/10/7/5,
  rematch with alternating dealer. (A 2 can always counter a one-off — a Queen only
  protects its owner's cards from being *targeted*, it does not block counters.)

Unit tests (Vitest) cover exactly the regression list: scuttle comparisons; counter
chains with 0/1/2/3 twos; queen edge cases (2 targeting the only queen is legal, double
queens protect each other, queens do not block counters); jack-stack control flipping across
multiple jacks; six reverting stolen cards; seven→one-off nesting (including countered
nested one-offs); the 9 house rule (card is the next draw); three-pass draw with pass
counter reset; king thresholds; plus guard/idempotence tests (double-tap replay of the
same action is rejected).

## 5. Mobile app (`apps/mobile`)

- **Expo SDK 53**, TypeScript, managed workflow. No navigation library — the app is two
  screens (lobby, game) switched by state, as in the legacy code.
- **Firebase JS SDK** (modular v11) with anonymous auth. Firestore is initialized with
  `experimentalAutoDetectLongPolling` (required on React Native) and auth with
  AsyncStorage persistence so the anonymous UID survives restarts.
- **UI port**: `StyleSheet` translation of the legacy CSS — same deep-sea palette
  (`#0d2b36` sea, `#e8b04b` gold, `#4fd6c5` teal, `#ff8a5c` coral, parchment cards),
  same layout (opponent zone / center strip / my zone / action menu / log), same
  modals (counter, discard, scrap-pick, scrap viewer, rules). Cards become touchables
  with the same select→action-menu→target-highlight flow.
- **Reconnect handling**: `onSnapshot` resubscribes automatically; the listener callback
  replaces local state whenever the incoming version is newer (and clears any selection
  / target mode, as the legacy poll loop did). A failed/stale commit is dropped locally
  and the UI re-renders from the authoritative snapshot. On foregrounding, the app
  re-reads the doc once (`AppState` listener) to cover long suspensions.
- **Room lifecycle** (task 4):
  - create: generate code from the legacy alphabet, transaction-create the doc.
  - join: read doc, claim empty p2 seat or rejoin a seat whose `name` matches.
  - rejoin after restart: `{ code, seat, name }` persisted in AsyncStorage; on launch
    the app offers "Resume game XXXX" and re-subscribes.
  - cleanup: every write stamps `expiresAt` = now + 7 days; the rules permit
    deleting only rooms past that mark, and the app deletes its own expired
    rooms when a device moves on. (Firestore TTL would automate this fully but
    requires billing; the `expiresAt` field is TTL-ready if that ever changes.)

## 6. Store distribution (task 5)

- `eas.json` with `development` / `preview` (internal APK + ad-hoc iOS) / `production`
  (store) profiles; `app.json` carries bundle IDs, icons, and the iOS/Android metadata
  EAS needs. Free-tier note: EAS Build's free plan covers this project's build volume;
  no paid service is added.
- The human checklist (developer accounts, signing, store listings, GDPR privacy
  policy, Firebase EU-region setup) is written out in `docs/STORE_CHECKLIST.md`.

## 7. Explicitly out of scope for v1

- Server-side move validation (Cloud Functions) — engine is structured for it, not built.
- Accounts / non-anonymous auth, matchmaking, room browser (dropped, see §3).
- Push notifications ("your turn") — nice later; needs Expo push tokens in the doc.
