import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth, User } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, FirebaseStorage } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const readEnv = (viteKey: string, nextPublicKey: string): string | undefined => {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[viteKey] ?? env[nextPublicKey];
};

const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY', 'NEXT_PUBLIC_FIREBASE_API_KEY'),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN', 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET', 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID', 'NEXT_PUBLIC_FIREBASE_APP_ID'),
  measurementId: readEnv('VITE_FIREBASE_MEASUREMENT_ID', 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID'),
};

const fcmVapidKey = readEnv('VITE_FIREBASE_VAPID_KEY', 'NEXT_PUBLIC_FCM_VAPID_KEY');

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;

// Initialize Analytics conditionally
export const analytics = isSupported().then(yes => yes ? getAnalytics(app) : null);

// FCM token management
export const getFCMToken = async (): Promise<string | null> => {
  if (!messaging) return null;
  if (!fcmVapidKey) return null;
  
  try {
    const currentToken = await getToken(messaging, {
      vapidKey: fcmVapidKey,
    });
    
    if (currentToken) {
      return currentToken;
    }
    
    console.log('No registration token available. Request permission to generate one.');
    return null;
  } catch (err) {
    console.log('An error occurred while retrieving token:', err);
    return null;
  }
};

// Message handler
export const onMessageListener = () => {
  if (!messaging) return Promise.reject('Messaging not initialized');
  
  return new Promise((resolve) => {
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });
};

// Helper function to check if a port is available
const isPortAvailable = async (port: number): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    
    await fetch(`http://localhost:${port}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return false; // Port is in use
  } catch (_) {
    return true; // Port is available
  }
};

// Helper function to connect to emulators
const connectToEmulators = async (
  auth: Auth,
  db: Firestore,
  storage: FirebaseStorage
) => {
  try {
    const authPort = 9099;
    const firestorePort = 8080;
    const storagePort = 9199;

    const [authAvailable, firestoreAvailable, storageAvailable] = await Promise.all([
      isPortAvailable(authPort),
      isPortAvailable(firestorePort),
      isPortAvailable(storagePort)
    ]);

    if (!authAvailable && !firestoreAvailable && !storageAvailable) {
      console.log('Connecting to Firebase Emulators...');
      connectAuthEmulator(auth, `http://localhost:${authPort}`, { disableWarnings: true });
      connectFirestoreEmulator(db, 'localhost', firestorePort);
      connectStorageEmulator(storage, 'localhost', storagePort);
      console.log('Connected to Firebase Emulators');
    } else {
      console.log('Firebase Emulators not detected, using production environment');
    }
  } catch (error) {
    console.error('Error connecting to emulators:', error);
    console.log('Using production environment');
  }
};

// Try to connect to emulators if in development
if (import.meta.env.DEV) {
  connectToEmulators(auth, db, storage);
}

// Auth state observer
auth.onAuthStateChanged((user: User | null) => {
  if (user) {
    console.log('User is signed in:', user.uid);
  } else {
    console.log('User is signed out');
  }
});
