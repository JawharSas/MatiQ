#!/usr/bin/env node
/**
 * Renders the MatIQ brand assets (app icon, Android adaptive and themed
 * icons, splash image, in-app logo, favicon) from the vector mark below, and
 * the Google "G" for the sign-in button, into assets/brand/. Run after
 * changing the mark:
 *
 *   npm run brand:assets --workspace @matiq/mobile
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../assets/brand');

const COLORS = {
  background: '#0B0D10',
  backgroundTop: '#1D2330',
  accentLight: '#FB923C',
  accent: '#F97316',
  accentDark: '#EA580C',
  white: '#F4F6FA',
};

/** Regular octagon (the cage / mat) around the centre of a 100 x 100 box. */
function octagon(radius) {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = ((22.5 + i * 45) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(' ');
}

/** Bold geometric "M" centred in the octagon. */
const M_PATH = 'M29 70V30h8.6L50 47.5 62.4 30H71v40h-8.2V44.6L50 62 37.2 44.6V70z';

/**
 * The mark in a 100 x 100 box: the "M" with a dot between its peaks reads as
 * a fighter with both arms raised, inside the cage. `mono` draws everything
 * in one colour (Android themed icons).
 */
function mark({ mono = false } = {}) {
  const accent = mono ? COLORS.white : 'url(#ring)';
  return `
    <defs>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${COLORS.accentLight}"/>
        <stop offset="1" stop-color="${COLORS.accentDark}"/>
      </linearGradient>
    </defs>
    <polygon points="${octagon(43)}" fill="none" stroke="${accent}" stroke-width="6.5" stroke-linejoin="round"/>
    <path d="${M_PATH}" fill="${COLORS.white}"/>
    <circle cx="50" cy="33.5" r="5.2" fill="${accent}"/>`;
}

function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** The mark scaled to `fraction` of a square canvas of `size` pixels, centred. */
function placedMark(size, fraction, options) {
  const scale = (size * fraction) / 100;
  const offset = (size - size * fraction) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${mark(options)}</g>`;
}

function iconBackground(size) {
  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${COLORS.backgroundTop}"/>
        <stop offset="1" stop-color="${COLORS.background}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${COLORS.accent}" stop-opacity="0.22"/>
        <stop offset="1" stop-color="${COLORS.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.42}" fill="url(#glow)"/>`;
}

/** Google's "G" (48 x 48 artwork) for the "Continue with Google" button. */
function googleG(size) {
  return `<g transform="scale(${size / 48})">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </g>`;
}

const ASSETS = [
  // iOS / legacy Android icon: full bleed, the platform rounds the corners.
  { file: 'icon.png', size: 1024, body: (s) => iconBackground(s) + placedMark(s, 0.66) },
  // Android adaptive icon: the mark must stay inside the 66% safe zone.
  { file: 'adaptive-icon.png', size: 1024, body: (s) => placedMark(s, 0.5), transparent: true },
  { file: 'adaptive-icon-background.png', size: 1024, body: (s) => iconBackground(s) },
  { file: 'adaptive-icon-monochrome.png', size: 1024, body: (s) => placedMark(s, 0.5, { mono: true }), transparent: true },
  // Splash screen (Android 12+ masks it to a circle, so it is the mark only).
  { file: 'splash-icon.png', size: 1024, body: (s) => placedMark(s, 0.92), transparent: true },
  // In-app logo and the download page.
  { file: 'logo-mark.png', size: 512, body: (s) => placedMark(s, 1), transparent: true },
  { file: 'favicon.png', size: 64, body: (s) => iconBackground(s) + placedMark(s, 0.8) },
  // Sign-in button (shown at 20 pt, so 3x).
  { file: 'google-g.png', size: 60, body: (s) => googleG(s), transparent: true },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'logo-mark.svg'), `${svg(100, mark())}\n`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const asset of ASSETS) {
      await page.setViewportSize({ width: asset.size, height: asset.size });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${svg(asset.size, asset.body(asset.size))}</body></html>`,
      );
      await page.locator('svg').screenshot({ path: path.join(OUT, asset.file), omitBackground: Boolean(asset.transparent) });
      console.log(`  ${asset.file} (${asset.size}px)`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
