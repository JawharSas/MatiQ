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
const APP_VERSION = '2.6.0';
// Empty for a full release; a channel name ("Alpha") for pre-releases.
const RELEASE_LABEL = '';
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
  // Light, Dark or Midnight in Settings → Appearance; "System" follows the phone.
  userInterfaceStyle: 'automatic',
  // Brand assets are rendered from the vector mark by scripts/brand-assets.cjs.
  icon: './assets/brand/icon.png',
  // Root view colour behind every screen (expo-system-ui): no white flashes.
  backgroundColor: '#0A0A0A',
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
    // The window shrinks above the keyboard, so focused fields stay visible.
    softwareKeyboardLayoutMode: 'resize',
    adaptiveIcon: {
      foregroundImage: './assets/brand/adaptive-icon.png',
      backgroundImage: './assets/brand/adaptive-icon-background.png',
      monochromeImage: './assets/brand/adaptive-icon-monochrome.png',
      backgroundColor: '#0A0A0A',
    },
    allowBackup: false,
    // Firebase for push notifications, when the release build has it (secret GOOGLE_SERVICES_JSON, release.yml).
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
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
        backgroundColor: '#0A0A0A',
      },
    ],
    'expo-secure-store',
    // Clerk's native sign-in and account screens (AuthView, UserProfileView), in MatIQ's colours.
    ['@clerk/expo-native-components', { theme: './clerk-theme.json' }],
    'expo-video',
    // Push notifications: a white MatIQ mark in the status bar, red in the shade.
    ['expo-notifications', { icon: './assets/brand/adaptive-icon-monochrome.png', color: '#DC2626' }],
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
        // Clerk's native components need iOS 17.
        ios: { deploymentTarget: '17.0' },
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
