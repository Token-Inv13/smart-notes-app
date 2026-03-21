/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tachesnotes.smartnotes',
  appName: 'Smart Notes',
  // Current Android shell strategy: load the hosted production web app.
  // We keep webDir for generated Capacitor assets, but native runtime points to server.url.
  webDir: 'public',
  server: {
    url: 'https://app.tasknote.io',
    cleartext: false,
    allowNavigation: [
      '*.google.com',
      '*.googleusercontent.com',
      '*.gstatic.com',
      '*.firebaseapp.com',
      '*.web.app',
    ],
  },
  plugins: {
    FirebaseAuthentication: {
      providers: ['google.com'],
    },
  },
};

export default config;
