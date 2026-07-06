# Firebase setup

One-time project setup (also summarized in `docs/STORE_CHECKLIST.md`):

1. Create a Firebase project at <https://console.firebase.google.com> (the free
   **Spark plan** is enough — nothing in this app needs Blaze).
2. **Firestore**: create the database in region **`europe-west3` (Frankfurt)**
   (GDPR: data stays in Germany). Start in *production mode*.
3. **Authentication**: enable the **Anonymous** sign-in provider.
4. **Web app**: add a Web app in project settings and copy its config into
   `apps/mobile/src/firebaseConfig.ts`.
5. **Deploy the rules** from this directory:

   ```sh
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

6. **Stale-room cleanup** — nothing to configure. Every write stamps the room
   with `expiresAt` = now + 30 days; the security rules allow deleting a room
   only once that moment has passed, and the app opportunistically deletes its
   own expired rooms when a device moves on (creates/joins another room or
   dismisses the resume banner). Rooms of players who never return linger as
   ~15 KB documents — harmless within the free 1 GiB storage quota.

   If you ever enable billing (Blaze plan), you can additionally add a
   Firestore **TTL policy** (Cloud console → Firestore → Time-to-live:
   collection group `rooms`, field `expiresAt`) for fully automatic deletion —
   the field is already maintained for exactly that. TTL policy management
   requires billing to be enabled, which is why it is not part of the
   default setup.

No Cloud Functions, no paid services.

> **Rules changed?** Re-publish after every change to `firestore.rules` —
> either `firebase deploy --only firestore:rules --project cuttlegame` or
> paste the file into the console's rules editor and hit Publish.
