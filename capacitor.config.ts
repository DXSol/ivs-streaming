import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dxsoltech.sampradayaevents',
  appName: 'Sampradaya Events',
  webDir: 'www',
  ios: {
    allowsLinkPreview: false
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
