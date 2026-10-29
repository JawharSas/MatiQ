import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Hardening applied at build time:
 *  - Android: R8 minification + resource shrinking, cleartext HTTP disabled,
 *    `allowBackup=false` so app data (incl. the encrypted MMKV store) is not
 *    copied into device/cloud backups.
 *  - iOS: App Transport Security stays at its HTTPS-only default.
 *  - JS is shipped as Hermes bytecode with console output stripped (metro.config.js).
 */

const IS_PRODUCTION = process.env.APP_VARIANT === 'production' || process.env.EAS_BUILD_PROFILE === 'production';

/** Marketing version and release channel ("Pre-Beta V1.3.0"). */
const APP_VERSION = '1.4.1';
const RELEASE_LABEL = 'Pre-Beta';
/** Monotonic build number for local / CI builds: 1.3.0 -> 10300 (EAS manages its own remotely). */
const BUILD_NUMBER = APP_VERSION.split('.').reduce((total, part) => total * 100 + Number(part), 0);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MatIQ',
  slug: 'matiq',
  scheme: 'matiq',
  version: APP_VERSION,
  // Follows the device: content is never locked to one orientation (WCAG 1.3.4).
  orientation: 'default',
  userInterfaceStyle: 'dark',
  // Brand assets are rendered from the vector mark by scripts/brand-assets.cjs.
  icon: './assets/brand/icon.png',
  // Root view colour behind every screen (expo-system-ui): no white flashes.
  backgroundColor: '#0B0D10',
  ios: {
    bundleIdentifier: 'app.matiq.mobile',
    buildNumber: String(BUILD_NUMBER),
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription: 'MatIQ uses the camera to record your sparring rounds for analysis.',
      NSMicrophoneUsageDescription: 'MatIQ records audio with your sparring videos when you enable it.',
      NSPhotoLibraryUsageDescription: 'MatIQ lets you pick sparring videos from your library to analyse.',
      NSFaceIDUsageDescription: 'MatIQ uses Face ID to protect sensitive settings such as your API keys.',
      // Only standard, exempt encryption (HTTPS, platform keychain) is used.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.matiq.mobile',
    versionCode: BUILD_NUMBER,
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-icon.png',
      backgroundImage: './assets/brand/adaptive-icon-background.png',
      monochromeImage: './assets/brand/adaptive-icon-monochrome.png',
      backgroundColor: '#0B0D10',
    },
    allowBackup: false,
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    blockedPermissions: ['android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/brand/splash-icon.png',
        imageWidth: 180,
        resizeMode: 'contain',
        backgroundColor: '#0B0D10',
      },
    ],
    'expo-secure-store',
    'expo-video',
    ['expo-local-authentication', { faceIDPermission: 'MatIQ uses Face ID to protect sensitive settings.' }],
    [
      'expo-image-picker',
      {
        photosPermission: 'MatIQ lets you pick sparring videos from your library to analyse.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          usesCleartextTraffic: false,
          extraProguardRules: [
            '-keep class com.margelo.nitro.** { *; }',
            '-keep class com.mrousavy.** { *; }',
            '-keep class com.tencent.mmkv.** { *; }',
          ].join('\n'),
        },
      },
    ],
  ],
  // Web is only the browser UI preview (sample data, see src/preview/README.md).
  web: { bundler: 'metro', output: 'single', favicon: './assets/brand/favicon.png' },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    isProduction: IS_PRODUCTION,
    releaseLabel: RELEASE_LABEL,
  },
});
