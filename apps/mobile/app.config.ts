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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MatIQ',
  slug: 'matiq',
  scheme: 'matiq',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: 'app.matiq.mobile',
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
    allowBackup: false,
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    blockedPermissions: ['android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
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
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    isProduction: IS_PRODUCTION,
  },
});
