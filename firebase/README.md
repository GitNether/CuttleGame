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

6. **TTL policy** (stale-room cleanup): in the Firebase console under
   Firestore → *Time-to-live*, add a TTL policy on collection group `rooms`,
   field `expiresAt`. The app refreshes `expiresAt` to now + 30 days on every
   move, so abandoned rooms are deleted automatically about 30 days after the
   last action. TTL deletes are free of charge.

No Cloud Functions, no paid services.
