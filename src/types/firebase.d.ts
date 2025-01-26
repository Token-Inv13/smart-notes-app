import { FirebaseApp } from '@firebase/app-types';
import { Auth } from '@firebase/auth-types';
import { Firestore } from '@firebase/firestore-types';
import { FirebaseStorage } from '@firebase/storage-types';
import { Analytics } from '@firebase/analytics-types';
import { Messaging } from '@firebase/messaging-types';

declare module 'firebase/app' {
  export function initializeApp(config: any): FirebaseApp;
}

declare module 'firebase/auth' {
  export function getAuth(app: FirebaseApp): Auth;
  export function connectAuthEmulator(auth: Auth, url: string): void;
}

declare module 'firebase/firestore' {
  export function getFirestore(app: FirebaseApp): Firestore;
  export function connectFirestoreEmulator(firestore: Firestore, host: string, port: number): void;
}

declare module 'firebase/storage' {
  export function getStorage(app: FirebaseApp): FirebaseStorage;
  export function connectStorageEmulator(storage: FirebaseStorage, host: string, port: number): void;
}

declare module 'firebase/analytics' {
  export function getAnalytics(app: FirebaseApp): Analytics;
  export function isSupported(): Promise<boolean>;
}

declare module 'firebase/messaging' {
  export function getMessaging(app: FirebaseApp): Messaging;
  export function getToken(messaging: Messaging, options: { vapidKey: string }): Promise<string>;
  export function onMessage(messaging: Messaging, callback: (payload: any) => void): () => void;
}
