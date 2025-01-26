import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth, User } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getStorage, connectStorageEmulator, FirebaseStorage } from 'firebase/storage';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: "AIzaSyBowWu2iQ6dKSfDLafA0KlnPB6q-z-gJdI",
  authDomain: "noandta-28cc8.firebaseapp.com",
  projectId: "noandta-28cc8",
  storageBucket: "noandta-28cc8.appspot.com",
  messagingSenderId: "515095303787",
  appId: "1:515095303787:web:dfa3498698d95ce32d032e",
  measurementId: "G-DDQK66WJ08"
};

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
  
  try {
    const currentToken = await getToken(messaging, {
      vapidKey: 'BJO_U00ZTBpBAdagrdexqiWwu37SHt-0gHy_GkwHXJwpRPz6b1nQBy2g9TE0ICz2qNQKF-YJuGuuOLqcRSNphLQ'
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
