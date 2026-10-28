#!/usr/bin/env node
/**
 * End-to-end UI walkthrough of the browser preview build (sample data, see
 * src/preview/README.md). Drives every screen and the main flows the way a
 * user would, saves a screenshot per step and fails on any uncaught page
 * error or React error.
 *
 *   npm run preview:web            # build dist-preview/
 *   npm run preview:walkthrough    # run this script
 *
 * Needs Playwright with Chromium (`npx playwright install chromium`).
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const serve = require('./preview-serve.cjs');

const DIST = path.resolve(process.argv[2] ?? 'dist-preview');
const OUT = path.resolve(process.argv[3] ?? 'preview-screenshots');
const EMAIL = 'demo@matiq.app';
const PASSWORD = 'matiq-preview';
const PHONE = { width: 390, height: 844 };

// Messages React and libraries log in development builds that are not app errors.
const IGNORED_CONSOLE = [/Download the React DevTools/, /props\.pointerEvents is deprecated/, /"shadow\*" style props are deprecated/];

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error(`No preview build in ${DIST}. Run npm run preview:web first.`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const { server, url } = await serve(DIST);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, colorScheme: 'dark', locale: 'en-US' });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !IGNORED_CONSOLE.some((pattern) => pattern.test(message.text()))) problems.push(`console error: ${message.text()}`);
  });
  // Confirmation dialogs (window.confirm in the preview) are accepted.
  page.on('dialog', (dialog) => void dialog.accept());

  let shotIndex = 0;
  const steps = [];
  const shot = async (name, { tall = false } = {}) => {
    await page.waitForTimeout(450);
    if (tall) await page.setViewportSize({ width: PHONE.width, height: 2600 });
    await page.waitForTimeout(tall ? 400 : 0);
    const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    if (tall) await page.setViewportSize(PHONE);
    steps.push(file);
  };
  const button = (name) => page.getByRole('button', { name, exact: true }).first();
  const tab = (name) => page.getByRole('tab', { name }).first();
  const matchLink = (title) => page.getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();
  // Background stack screens stay in the DOM: only count visible text.
  const see = (text, timeout = 10_000) => page.getByText(text, { exact: false }).locator('visible=true').first().waitFor({ timeout });
  const step = async (name, run) => {
    try {
      await run();
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, `FAILED-${name}.png`) }).catch(() => undefined);
      const recent = problems.length ? `\nRuntime problems so far:\n${[...new Set(problems)].join('\n')}` : '';
      throw new Error(`Step "${name}" failed: ${error.message}${recent}`);
    }
    console.log(`  ok  ${name}`);
  };

  try {
    await step('sign-in', async () => {
      await page.goto(url);
      await page.getByLabel('Email').waitFor();
      await shot('sign-in');
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password').fill('wrong-password');
      await button('Sign in').click();
      await see('Incorrect email or password');
      await page.getByLabel('Password').fill(PASSWORD);
      await button('Sign in').click();
    });

    await step('consent gate', async () => {
      await see('Please review our policies');
      await shot('consent-gate');
      await button('I agree').click();
    });

    await step('feed', async () => {
      await see('Three takedowns');
      await shot('feed');
      await page.getByRole('button', { name: 'Like' }).first().click();
      await page.getByRole('button', { name: 'Unlike' }).first().waitFor();
      await tab('Friends').click();
      await page.waitForTimeout(500);
      await shot('feed-friends');
    });

    await step('record and analyse', async () => {
      await tab('Analyze').click();
      await see('Match setup');
      await shot('analyze-setup', { tall: true });
      await page.getByRole('tab', { name: 'Upload video' }).click();
      await shot('analyze-upload-mode');
      await page.getByRole('tab', { name: 'Record live' }).click();
      await page.getByLabel('Title (optional)').fill('Preview round');
      await button('Open camera').click();
      await page.getByRole('button', { name: 'Start recording' }).waitFor();
      await shot('recorder-ready');
      await page.getByRole('button', { name: 'Start recording' }).click();
      await page.waitForTimeout(2200);
      await shot('recorder-recording');
      await page.getByRole('button', { name: 'Stop recording' }).click();
      await page.getByText(/Queued for analysis|Analysing your round|Technique breakdown/).first().waitFor({ timeout: 20_000 });
      await shot('analysis-in-progress');
      await see('Technique breakdown', 20_000);
      await shot('new-match-dashboard', { tall: true });
    });

    await step('matches and dashboards', async () => {
      await page.goBack();
      await tab('Matches').click();
      await see('Tuesday open mat');
      await shot('matches-list');
      await matchLink('Comp prep round').click();
      await see('Analysis failed');
      await shot('match-failed');
      await button('Retry analysis').click();
      await see('Technique breakdown', 20_000);
      await page.goBack();
      await matchLink('Tuesday open mat').click();
      await see('Technique breakdown');
      await shot('bjj-dashboard', { tall: true });
      await page.getByRole('tab', { name: 'Alex', exact: true }).click();
      await shot('bjj-dashboard-filtered', { tall: true });
      await page.goBack();
      await matchLink('Sparring: 3 x 5').click();
      await see('Rounds (projected)');
      await shot('mma-dashboard', { tall: true });
      await page.goBack();
      await matchLink('Live goes with Sam').click();
      await see('Technique breakdown');
      await shot('wrestling-dashboard', { tall: true });
      await page.goBack();
    });

    await step('ranked tab', async () => {
      await tab('Ranked').click();
      await see('Needs you');
      await shot('ranked', { tall: true });
      await button('Accept').click();
      await see('Accepted: record it by');
    });

    await step('confirm a ranked result', async () => {
      await button('Review result').click();
      await see('Confirm result');
      await shot('ranked-review');
      await button('Confirm result').click();
      await see('Lost', 15_000);
      await shot('ranked-confirmed');
      await page.goBack();
    });

    await step('ranked recording', async () => {
      await see('Ranked matches');
      await button('Record it').click();
      await see('Ranked: Alex Rivera vs');
      await shot('ranked-recording-setup', { tall: true });
      await button('Record a casual match instead').click();
      await see('Match setup');
    });

    await step('matchmaking, ladder and titles', async () => {
      await tab('Ranked').click();
      await button('Find an opponent').click();
      await see('Ruleset for the challenge');
      await shot('opponents', { tall: true });
      await button('Challenge').click();
      await see('Find an opponent');
      await button('Leaderboard').click();
      await see('Fighters appear after 5 placement matches');
      await shot('leaderboard', { tall: true });
      await page.getByRole('tab', { name: 'Friends' }).click();
      await page.waitForTimeout(600);
      await shot('leaderboard-friends');
      await page.goBack();
      await button('Titles').click();
      await see('Takedown Machine');
      await shot('titles', { tall: true });
      await page.getByRole('button', { name: 'Feature on profile' }).first().click();
      await page.waitForTimeout(600);
      await page.goBack();
    });

    await step('profile and friends', async () => {
      await tab('Profile').click();
      await see('Alex Rivera');
      await shot('profile', { tall: true });
      await button('Friends & requests').click();
      await see('Requests');
      await shot('friends');
      await button('Accept').click();
      await page.waitForTimeout(600);
      await page.getByText('Sam Okafor').locator('visible=true').first().click();
      await see('@sam_okafor');
      await shot('user-profile', { tall: true });
      await page.goBack();
      await page.goBack();
    });

    await step('settings and two-factor', async () => {
      await see('Settings');
      await button('Settings').click();
      await see('Delete account');
      await shot('settings', { tall: true });
      await button('Two-factor authentication').click();
      await button('Set up authenticator').click();
      await see('Add MatIQ to your authenticator');
      await shot('two-factor-setup', { tall: true });
      await page.getByLabel('6-digit code').fill('000000');
      await button('Turn on').click();
      await see('That code is incorrect');
      await page.getByLabel('6-digit code').fill('123456');
      await button('Turn on').click();
      await see('On · added');
      await shot('two-factor-on');
      await page.goBack();
      await button('Privacy Policy').click();
      await see('never sell');
      await shot('privacy-policy', { tall: true });
      await page.goBack();
    });

    await step('owner panel', async () => {
      await page.goBack();
      await see('Owner panel');
      await button('Owner panel').click();
      await see('All owner actions are recorded');
      await shot('owner-users', { tall: true });
      await page.getByRole('tab', { name: 'Usage' }).click();
      await page.waitForTimeout(700);
      await shot('owner-usage', { tall: true });
      await page.getByRole('tab', { name: 'Disputes' }).click();
      await see('Analysed result');
      await shot('owner-disputes');
      await button('Void match').click();
      await see('No open disputes');
      await page.getByRole('tab', { name: 'Audit log' }).click();
      await see('resolve ranked dispute');
      await shot('owner-audit-log');
      await page.goBack();
    });

    await step('sign out and two-factor sign-in', async () => {
      await button('Settings').click();
      await button('Sign out').click();
      await page.getByLabel('Email').waitFor();
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password').fill(PASSWORD);
      await button('Sign in').click();
      await see('Two-factor verification');
      await shot('mfa-challenge');
      await page.getByLabel('Code').fill('123456');
      await button('Verify').click();
      await see('Three takedowns');
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${steps.length} screenshots in ${OUT}`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} runtime problem(s):\n${[...new Set(problems)].join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('No runtime errors.');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
