// Firebase web-app config. This is NOT a secret (it ships inside the app
// binary); access control lives entirely in firestore.rules.
//
// Fill in the values from: Firebase console → Project settings → Your apps
// → Web app. Create the Firestore database in an EU region (europe-west3,
// Frankfurt) — see docs/STORE_CHECKLIST.md.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
