// Metro configuration. Expo auto-detects the npm workspace, so
// packages/rules-engine is watched and resolved without extra settings.
// Production hardening of the JS output (console stripping) lives in
// babel.config.js because release builds are Hermes bytecode, for which Expo
// does not run the JS minifier.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
