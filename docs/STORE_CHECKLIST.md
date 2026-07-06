# Manual steps to ship Cuttle Online — your checklist

Everything the repo can't do for you. Work top to bottom; the early parts are
needed just to run the app, the later parts only for store submission.

Costs you should expect (there is no way around these for store distribution):

- **Apple Developer Program: 99 €/year**
- **Google Play Console: 25 US$ once**
- Everything else in this list (Firebase Spark plan, EAS free tier, GitHub
  Pages for the privacy policy) is free.

## 1. Firebase project (needed before the app runs at all)

- [ ] Create a Firebase project (free Spark plan) at console.firebase.google.com.
- [ ] Create the **Firestore database in `europe-west3` (Frankfurt)** — the
      region cannot be changed later, and an EU region keeps you comfortable
      under GDPR (data never leaves Germany).
- [ ] Enable **Anonymous** authentication (Build → Authentication → Sign-in method).
- [ ] Add a **Web app** in project settings; copy its config object into
      `apps/mobile/src/firebaseConfig.ts`.
- [ ] Deploy the security rules: `firebase deploy --only firestore:rules`
      from the `firebase/` directory (see `firebase/README.md`).
- [ ] Add the **TTL policy**: Firestore → Time-to-live → collection group
      `rooms`, field `expiresAt`. This is the stale-room cleanup.
- [ ] Smoke test: `cd apps/mobile && npx expo start`, open it in Expo Go on
      two phones, create a room on one and join from the other.

## 2. Expo / EAS setup

- [ ] Create an Expo account (free) and log in: `npx eas login`.
- [ ] In `apps/mobile/`, run `npx eas init` — this creates the EAS project and
      replaces `REPLACE_WITH_EAS_PROJECT_ID` in `app.json`.
- [ ] Check the bundle identifiers in `app.json` (`de.gitnether.cuttle` for
      both stores) — change them now if you want something else; they are
      permanent once an app is created in the stores.
- [ ] App icon + splash: drop `icon.png` (1024×1024) and a splash image into
      `apps/mobile/assets/` and reference them from `app.json` (`"icon"`,
      `"splash".image`, `"android".adaptiveIcon.foregroundImage`). Until you
      do, builds use Expo's defaults.
- [ ] Test build for your own devices first:
      `npx eas build --profile preview --platform android` (installable APK)
      and, once your Apple account exists, `--platform ios` with your device
      UDID registered (`npx eas device:create`).

The EAS **free tier** covers this project's build volume; builds queue longer
than on paid plans, that's all. If EAS ever asks you to upgrade, stop and
reconsider — nothing in this project requires it.

## 3. Apple (iOS)

- [ ] Enroll in the Apple Developer Program (developer.apple.com, 99 €/year,
      takes a day or two to be approved).
- [ ] Let EAS manage signing: the first `npx eas build --profile production
      --platform ios` walks you through creating certificates and profiles
      automatically — accept the defaults, don't create anything by hand.
- [ ] Create the app in App Store Connect (appstoreconnect.apple.com):
      name "Cuttle Online" (or your pick), primary language, bundle ID from
      `app.json`, SKU can be anything.
- [ ] Put the numeric App Store Connect app ID into `eas.json` →
      `submit.production.ios.ascAppId`, then submit with `npx eas submit -p ios`.
- [ ] App Store listing: description, keywords, screenshots (6.7" and 6.5"
      iPhone sizes are mandatory; take them in the iOS simulator), support URL,
      marketing URL (optional).
- [ ] App Privacy questionnaire ("nutrition label") — with this codebase the
      truthful answers are: data collected: **Identifiers** (anonymous user ID)
      and **User Content** (player name, game moves), linked to the user: no,
      used for tracking: no. No third-party ads or analytics.
- [ ] Export compliance is pre-answered in `app.json`
      (`ITSAppUsesNonExemptEncryption: false` — the app only uses standard TLS).
- [ ] Age rating questionnaire: no objectionable content → 4+.

## 4. Google (Android)

- [ ] Create a Play Console developer account (play.google.com/console,
      25 US$ one-time; identity verification can take a few days).
- [ ] Create the app in the Play Console (name, default language, "App",
      free).
- [ ] First submission must be uploaded manually: build with
      `npx eas build --profile production --platform android` (produces an
      .aab), download it and upload to an internal-testing release in the
      Play Console. After that, `npx eas submit -p android` works (it needs a
      service-account JSON — the EAS docs walk you through it; keep that JSON
      out of git).
- [ ] Accept **Play App Signing** (default) — Google holds the release key,
      EAS holds the upload key. Nothing to manage by hand.
- [ ] Data safety form — mirrors the Apple answers: collects pseudonymous
      identifiers + user-provided name/game data, encrypted in transit, users
      can't request in-app deletion (data auto-deletes after 30 days), no
      sharing with third parties, no ads.
- [ ] Content rating questionnaire (IARC): card game, no gambling with real
      money → rated 3+/E. Note: even though Cuttle uses playing cards, there
      is no wagering — answer the gambling questions with "no".
- [ ] Store listing: short + full description, screenshots (phone), feature
      graphic (1024×500), app icon (512×512).
- [ ] Google requires ~20 testers for 14 days on a *personal* developer
      account created after Nov 2023 before you can go to production — plan
      for this, or keep the app in internal/closed testing for you and your
      friends (which honestly may be all you need).

## 5. Privacy policy (GDPR) — required by BOTH stores

Host a short page (GitHub Pages is free and fine) and link it in both store
listings and in the app listing metadata. It must state, in plain language:

- [ ] **Who you are** (name, contact email — as the "controller" under GDPR
      Art. 4, that's you as a private person).
- [ ] **What is processed**: a self-chosen display name, an anonymous device
      identifier (Firebase anonymous auth UID), and the moves/state of games
      you play. No email, no real name, no location, no advertising ID.
- [ ] **Where**: Google Firebase (Firestore + Authentication), stored in
      **Frankfurt, Germany (europe-west3)**. Processor: Google Cloud EMEA Ltd
      (Ireland), under the EU Standard Contractual Clauses / Data Processing
      Terms (link to https://firebase.google.com/terms/data-processing-terms).
- [ ] **Legal basis**: contract performance (GDPR Art. 6(1)(b) — you need the
      data to play the game you asked for).
- [ ] **Retention**: game rooms are deleted automatically 30 days after the
      last move (the Firestore TTL). Uninstalling the app removes the local
      session; the anonymous account becomes orphaned and its rooms expire.
- [ ] **Rights**: access, rectification, erasure, complaint to a supervisory
      authority; how to contact you to exercise them (e.g. email with the
      room code, since the anonymous UID isn't user-visible).
- [ ] **No tracking**: no analytics, no ads, no profiling — say so explicitly;
      it also makes both store questionnaires trivially consistent.
- [ ] German + English versions if you can — for a DE-targeted listing the
      German version is the one that matters.

## 6. Before each release

- [ ] `npm test` (engine) and `npm run typecheck` at the repo root are green.
- [ ] Play one full game between two devices, including a rematch.
- [ ] Bump nothing by hand — `eas.json` has `autoIncrement` for build numbers;
      change the marketing version in `app.json` (`"version"`) when you want
      a new store version.
