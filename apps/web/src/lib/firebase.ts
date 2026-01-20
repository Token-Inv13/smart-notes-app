import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  type Auth,
  type User,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  getFirestore,
  type Firestore,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getStorage,
  type FirebaseStorage,
  connectStorageEmulator,
} from 'firebase/storage';
import {
  getMessaging,
  type Messaging,
  getToken,
  onMessage,
  isSupported as isMessagingSupported,
} from 'firebase/messaging';
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
  type Analytics,
} from 'firebase/analytics';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
      ? `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`
      : undefined),
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
  throw new Error('Missing required Firebase environment variables');
}

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;
let messagingPromise: Promise<Messaging | null> | null = null;
let analyticsPromise: Promise<Analytics | null> | null = null;

function initFirebase() {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0]!;
  }

  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);

  if (useEmulators && typeof window !== 'undefined') {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, 'localhost', 8080);
    connectStorageEmulator(storage, 'localhost', 9199);
  }

  if (typeof window !== 'undefined') {
    messagingPromise = isMessagingSupported().then((supported) =>
      supported ? getMessaging(app) : null,
    );

    analyticsPromise = isAnalyticsSupported().then((supported) =>
      supported ? getAnalytics(app) : null,
    );
  }
}

initFirebase();

export { app, auth, db, storage, onAuthStateChanged, getToken, onMessage };
export type { User, Messaging };

export async function getMessagingInstance(): Promise<Messaging | null> {
  if (!messagingPromise) return null;
  return messagingPromise;
}

export async function getAnalyticsInstance(): Promise<Analytics | null> {
  if (!analyticsPromise) return null;
  return analyticsPromise;
}
