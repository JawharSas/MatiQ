#!/usr/bin/env node
/**
 * Renders the MatIQ brand assets (app icon, Android adaptive and themed
 * icons, splash image, in-app logo, favicon) from the vector mark below into
 * assets/brand/. Run after changing the mark:
 *
 *   npm run brand:assets --workspace @matiq/mobile
 *
 * Needs Playwright's Chromium (`npx playwright install chromium`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.resolve(__dirname, '../assets/brand');

/** Flat colours only (no gradients): black, white and the app's brand red. */
const COLORS = {
  background: '#0A0A0A',
  /** Brand red (the themes' accentFill). */
  accent: '#DC2626',
  /** The ring on light backgrounds. */
  accentInk: '#DC2626',
  white: '#FAFAFA',
  /** The "M" on light backgrounds (the app's Light theme text colour). */
  ink: '#0A0A0A',
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
 * in one colour (Android themed icons); `ink` colours the "M" and `ring` the
 * cage and dot (darker on light backgrounds).
 */
function mark({ mono = false, ink = COLORS.white, ring = COLORS.accent } = {}) {
  const accent = mono ? COLORS.white : ring;
  return `
    <polygon points="${octagon(43)}" fill="none" stroke="${accent}" stroke-width="6.5" stroke-linejoin="round"/>
    <path d="${M_PATH}" fill="${mono ? COLORS.white : ink}"/>
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
  return `<rect width="${size}" height="${size}" fill="${COLORS.background}"/>`;
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
  { file: 'logo-mark-light.png', size: 512, body: (s) => placedMark(s, 1, { ink: COLORS.ink, ring: COLORS.accentInk }), transparent: true },
  { file: 'favicon.png', size: 64, body: (s) => iconBackground(s) + placedMark(s, 0.8) },
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
