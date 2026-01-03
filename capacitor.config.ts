import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dxsoltech.sampradayaevents',
  appName: 'Sampradaya Events',
  webDir: 'www',
  ios: {
    allowsLinkPreview: false
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true
  },
  server: {
    androidScheme: 'https',
    cleartext: true
  },
  plugins: {
    App: {
      // Prevent app from being killed when in background
      keepRunning: true
    }
  }
};

export default config;
