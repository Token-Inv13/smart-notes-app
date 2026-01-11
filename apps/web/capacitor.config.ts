import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tachesnotes.smartnotes',
  appName: 'Smart Notes',
  webDir: 'public',
  server: {
    url: 'https://app.tachesnotes.com',
    cleartext: false,
  },
};

export default config;
