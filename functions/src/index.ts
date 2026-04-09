import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// --- API ---
export * from './api/tasks';
export * from './api/assistant';

// --- Services ---
export * from './services/ai';
export * from './services/telemetry';
export * from './services/email';
export * from './services/ops';

// --- Assistant Logic ---
export * from './assistant/aiJobQueue';
export * from './assistant/voiceIntent';

// --- Legacy Exports / To be moved later ---
export * from './admin';
export { syncTaskToGoogleCalendar } from './googleCalendarSync';
