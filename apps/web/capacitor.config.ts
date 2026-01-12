/// <reference types="@capacitor-firebase/authentication" />

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tachesnotes.smartnotes',
  appName: 'Smart Notes',
  webDir: 'public',
  server: {
    url: 'https://app.tachesnotes.com',
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
