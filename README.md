# 🦑 Cuttle Online

Two-player online implementation of **Cuttle** (the 1975 combat card game) as a
cross-platform mobile app: Expo (React Native) + Firebase, migrated from the
original single-file web artifact (`legacy/cuttle-online.jsx`). Also includes a
**single-player mode vs a built-in AI** that works fully offline.

Rules reference: <https://github.com/shmup/card-game-rules/blob/master/cuttle.md>
— plus one house rule: the **9 one-off places the targeted permanent on top of
the draw pile** instead of returning it to its controller's hand.

## Layout

| Path | What |
|---|---|
| `packages/engine` | Pure TypeScript game engine + heuristic AI, no dependencies, 65 unit tests |
| `apps/mobile` | Expo app (iOS + Android): UI (`game/GameBoard`), online (Firestore) + offline (AI) game modes |
| `firebase/` | Firestore security rules + setup instructions |
| `docs/MIGRATION_PLAN.md` | Architecture, Firestore schema, sync/commit protocol |
| `docs/STORE_CHECKLIST.md` | Manual steps: Firebase, EAS, App Store, Play Store, GDPR privacy policy |
| `legacy/cuttle-online.jsx` | The original artifact implementation (reference) |

## Development

```sh
npm install            # once, at the repo root (npm workspaces)
npm test               # engine unit tests (Vitest)
npm run typecheck      # engine + app

cd apps/mobile
npx expo start         # run in Expo Go / dev client
```

Before the app can talk to a backend you need a (free) Firebase project —
follow `firebase/README.md`. Store submission steps live in
`docs/STORE_CHECKLIST.md`.

## Sync model (v1)

The acting player's client resolves moves with the shared engine and commits
the whole game state to `rooms/{code}` in a Firestore **transaction guarded by
a version counter** (enforced again by the security rules), so writes can never
land out of order and an action can never apply twice. Both clients render from
the realtime snapshot listener. Server-side validation (Cloud Functions
replaying actions through `@cuttle/engine`) is the planned v2 hardening step.
