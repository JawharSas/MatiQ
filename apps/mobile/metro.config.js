// Metro configuration. Expo auto-detects the npm workspace, so
// packages/rules-engine is watched and resolved without extra settings.
// Production hardening of the JS output (console stripping) lives in
// babel.config.js because release builds are Hermes bytecode, for which Expo
// does not run the JS minifier.
//
// The web platform exists only for the browser UI preview (sample data, no
// camera; see src/preview/README.md). There, native-only packages resolve to
// small stubs; iOS and Android builds are unaffected.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_STUBS = {
  'react-native-vision-camera': 'src/preview/stubs/vision-camera.tsx',
  'react-native-nitro-image': 'src/preview/stubs/nitro-image.ts',
  'expo-file-system': 'src/preview/stubs/file-system.ts',
  'expo-screen-capture': 'src/preview/stubs/screen-capture.ts',
  '@clerk/expo': 'src/preview/stubs/clerk.tsx',
  '@clerk/expo/token-cache': 'src/preview/stubs/clerk.tsx',
  'expo-web-browser': 'src/preview/stubs/web-browser.ts',
};

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_STUBS[moduleName]) {
    return { type: 'sourceFile', filePath: path.join(__dirname, WEB_STUBS[moduleName]) };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
