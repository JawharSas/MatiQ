#!/usr/bin/env node
/**
 * End-to-end UI walkthrough of the browser preview build (sample data, see
 * src/preview/README.md). Drives every screen and the main flows the way a
 * user would, saves a screenshot per step and fails on any uncaught page
 * error or React error. Every screenshot is also checked with axe-core
 * against WCAG 2.2 A and AA; violations are written to a11y-report.json in
 * the screenshot folder and fail the run.
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

const AXE = require.resolve('axe-core/axe.min.js');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

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

  let reportedPostId = '';
  let shotIndex = 0;
  const steps = [];
  const a11y = [];
  const audit = async (screen) => {
    if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
    const violations = await page.evaluate(
      (tags) =>
        window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }).then((result) =>
          result.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary, html: n.html.slice(0, 200) })),
          })),
        ),
      WCAG_TAGS,
    );
    if (violations.length) a11y.push({ screen, violations });
  };
  const shot = async (name, { tall = false } = {}) => {
    await page.waitForTimeout(450);
    if (tall) await page.setViewportSize({ width: PHONE.width, height: 2600 });
    await page.waitForTimeout(tall ? 400 : 0);
    const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file) });
    await audit(file);
    if (tall) await page.setViewportSize(PHONE);
    steps.push(file);
  };
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A list row's name is its title plus its subtitle (WCAG 2.5.3), so match the title and an optional capitalised subtitle.
  const button = (name) => page.getByRole('button', { name: new RegExp(`^${escape(name)}(?:\\s*[A-Z].*)?$`) }).first();
  const tab = (name) => page.getByRole('tab', { name }).first();
  // Settings is behind the gear on Profile, above the tabs.
  const openSettings = async () => {
    await tab('Profile').click();
    await button('Settings').click();
    await see('Delete account');
  };
  // Screens further down the stack keep their fields in the DOM: only fill visible ones.
  const field = (label) => page.getByLabel(label).locator('visible=true').first();
  const matchLink = (title) => page.getByRole('link', { name: new RegExp(`^${escape(title)}`) }).first();
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
      // Clerk's AuthView (the preview's stand-in): its errors are Clerk's.
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill('wrong-password');
      await button('Continue').click();
      await see('Password is incorrect');
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await button('Continue').click();
    });

    await step('age check and consent gate', async () => {
      await see('Before you continue');
      await shot('consent-gate', { tall: true });
      await button('Continue').click();
      await see('Choose your birth month');
      await page.getByRole('radio', { name: 'May' }).click();
      await page.getByLabel('Birth year').fill('1995');
      await button('Continue').click();
      await see('Tick the box to agree');
      await page.getByRole('checkbox', { name: /^I agree/ }).click();
      await shot('consent-gate-filled', { tall: true });
      await button('Continue').click();
      // The owner role is looked up before the age check, while the server
      // refuses everything but reads: it must still show straight away.
      await tab('Profile').click();
      await see('Owner panel');
      await tab('Feed').click();
    });

    await step('feed', async () => {
      await see('Three takedowns');
      await shot('feed');
      await page.getByRole('button', { name: 'Like' }).first().click();
      await page.getByRole('button', { name: 'Unlike' }).first().waitFor();
      await tab('Friends').click();
      await page.waitForTimeout(500);
      await shot('feed-friends');
      await tab('Community').click();
      await button('More options for this post').click();
      await page.getByRole('link', { name: 'Report post', exact: true }).first().click();
      await see('What is wrong with this post?');
      reportedPostId = (await page.getByText(/^[0-9a-f]{8}-[0-9a-f-]{27}$/).locator('visible=true').first().textContent()).trim();
      await shot('report-post');
      await button('Cancel').click();
      await see('Three takedowns');
      // Orientation (WCAG 1.3.4) and reflow at 320 px (1.4.10).
      await page.setViewportSize({ width: 844, height: 390 });
      await shot('feed-landscape');
      await page.setViewportSize({ width: 320, height: 640 });
      await shot('feed-320px');
      await page.setViewportSize(PHONE);
    });

    await step('comments', async () => {
      // Sam's post, where Jordan already commented.
      await page.getByRole('link', { name: 'Comments, 1 comment' }).first().click();
      await see('The near fall in the second was nasty.');
      await field('Add a comment').fill('Clean chain wrestling. What was the setup on the first shot?');
      await button('Post comment').click();
      await see('What was the setup on the first shot?');
      await shot('comments', { tall: true });
      // The word filter applies to comments too.
      await field('Add a comment').fill('nice p 0 r n');
      await button('Post comment').click();
      await see("That includes words MatIQ doesn't allow");
      await page.goBack();
      await see('Three takedowns');
    });

    await step('record and analyse', async () => {
      await tab('Record a round').click();
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
      await page.getByText(/Queued for analysis|Analysing your round|Key moments/).first().waitFor({ timeout: 20_000 });
      await shot('analysis-in-progress');
      await see('Key moments', 20_000);
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
      await see('Key moments', 20_000);
      await page.goBack();
      await matchLink('Tuesday open mat').click();
      await see('Key moments');
      await shot('bjj-dashboard', { tall: true });
      // The match screen's sections.
      await tab('Moments').click();
      await see('Timeline');
      await shot('bjj-dashboard-moments', { tall: true });
      await tab('Stats').click();
      await see('Technique breakdown');
      await shot('bjj-dashboard-stats', { tall: true });
      await tab('Log').click();
      await see('About this analysis');
      await shot('bjj-dashboard-log', { tall: true });
      await tab('Overview').click();
      await button('Share to feed').click();
      await see('Share your scorecard');
      await page.getByRole('radio', { name: /^0:25/ }).first().click();
      await shot('share', { tall: true });
      // The word filter sees through spacing and swapped characters.
      await page.getByLabel('Caption').fill('nice p 0 r n');
      await button('Post').click();
      await see("This post wasn't shared");
      await shot('share-filtered');
      // Comments can be turned off before posting.
      await page.getByLabel('Caption').fill('Back takes are finally clicking.');
      await page.getByRole('switch', { name: 'Allow comments' }).click();
      await button('Post').click();
      await see('Key moments');
      await tab('Moments').click();
      await page.getByRole('tab', { name: 'Alex', exact: true }).click();
      await shot('bjj-dashboard-filtered', { tall: true });
      await page.goBack();
      await matchLink('Sparring: 3 x 5').click();
      await see('Key moments');
      await tab('Stats').click();
      await see('Rounds (projected)');
      await shot('mma-dashboard', { tall: true });
      await page.goBack();
      await matchLink('Live goes with Sam').click();
      await see('Key moments');
      await shot('wrestling-dashboard', { tall: true });
      await page.goBack();
      // The post went out with comments off; its author can turn them on.
      await tab('Feed').click();
      await see('Back takes are finally clicking.');
      await page.getByRole('link', { name: 'Comments off, 0 comments' }).first().click();
      await see('You turned off comments on this post.');
      await shot('comments-off');
      await page.getByRole('switch', { name: 'Allow comments' }).click();
      await button('Post comment').waitFor();
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
      // A reserved name answers like one that's in use.
      await button('Edit profile').click();
      await see(/Change picture|Add a picture/);
      await shot('edit-profile', { tall: true });
      await field('Display name').fill('Coach Max');
      await button('Save').click();
      await see('That is already taken.');
      // Privacy is on Edit profile now: private, then public again.
      const privacy = page.getByRole('switch', { name: 'Public account' });
      await privacy.click();
      await see('Only friends you approve');
      await privacy.click();
      await see('Anyone signed in to MatIQ');
      await page.goBack();
      await see('Alex Rivera');
      await button('Friends (1 new)').click();
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

    await step('settings and account', async () => {
      await openSettings();
      await shot('settings', { tall: true });
      // Clerk's UserProfileView (the preview's stand-in) with its own back button.
      await button('Account and security').click();
      await see('Email addresses');
      await shot('account-and-security');
      await button('Back').click();
      await see('Delete account');
      await button('AI provider').click();
      await see('Use any AI');
      await page.getByLabel('API key').fill('sk-proj-preview0123456789abcdefghij');
      await see('keys at platform.openai.com');
      await shot('ai-provider-key', { tall: true });
      await button('Check key').click();
      await see('Choose a model');
      await page.getByRole('radio', { name: /^gpt-5-mini/ }).click();
      await shot('ai-provider-models', { tall: true });
      await button('Test and save').click();
      await see('is ready');
      await see('In use');
      await shot('ai-provider', { tall: true });
      await page.goBack();
      await button('Privacy Policy').click();
      await see('never sell');
      await shot('privacy-policy', { tall: true });
      await page.goBack();
      await button('Copyright and DMCA').click();
      await see('Designated agent');
      await shot('copyright-policy', { tall: true });
      await page.goBack();
      await button('Accessibility').click();
      await see('Works with your phone');
      await shot('accessibility', { tall: true });
      await page.getByRole('tab', { name: 'Largest' }).click();
      await page.getByRole('switch', { name: 'High contrast' }).click();
      await shot('accessibility-largest-high-contrast', { tall: true });
      await page.goBack();
      await see('Delete account');
      await shot('settings-largest-high-contrast', { tall: true });
      await button('Accessibility').click();
      await page.getByRole('tab', { name: 'Default' }).click();
      await page.getByRole('switch', { name: 'High contrast' }).click();
      await page.goBack();
    });

    await step('themes: light and midnight', async () => {
      await button('Theme').click();
      await see('Pure black');
      await shot('appearance');
      await page.getByRole('radio', { name: /^White/ }).click();
      await shot('appearance-light');
      await page.goBack();
      await see('Delete account');
      await shot('settings-light', { tall: true });
      await page.goBack();
      await tab('Feed').click();
      await shot('feed-light', { tall: true });
      await tab('Matches').click();
      await matchLink('Tuesday open mat').click();
      await see('Key moments');
      await shot('dashboard-light', { tall: true });
      await page.goBack();
      await tab('Ranked').click();
      await shot('ranked-light', { tall: true });
      await tab('Profile').click();
      await shot('profile-light', { tall: true });
      await openSettings();
      await button('Theme').click();
      await page.getByRole('radio', { name: /^Midnight/ }).click();
      await page.goBack();
      await shot('settings-midnight', { tall: true });
      await page.goBack();
      await tab('Feed').click();
      await shot('feed-midnight', { tall: true });
      await tab('Matches').click();
      await matchLink('Tuesday open mat').click();
      await see('Key moments');
      await shot('dashboard-midnight', { tall: true });
      await page.goBack();
      // Back to the phone's setting (dark in this browser).
      await openSettings();
      await button('Theme').click();
      await page.getByRole('radio', { name: /^Match my phone/ }).click();
      await page.goBack();
      await page.goBack();
    });

    await step('owner panel', async () => {
      await tab('Profile').click();
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
      await page.getByRole('tab', { name: 'Moderation' }).click();
      await see('Recent strikes');
      await see('check my onlyfans');
      await shot('owner-moderation', { tall: true });
      await button('Show the list (6)').click();
      await see('sieg heil');
      await page.getByLabel('Word or phrase to block').fill('sandbagger');
      await button('Add to the filter').click();
      await see('sandbagger');
      await page.getByRole('tab', { name: 'Users' }).click();
      await page.getByLabel('Search by username, email or user id').fill('tomas');
      // The search runs as you type: wait for the one match.
      await page.waitForFunction(
        () => [...document.querySelectorAll('[role="button"]')].filter((el) => el.textContent === 'Manage').length === 1,
      );
      await see('@tomas_ruiz');
      await button('Manage').click();
      await page.getByLabel('Ban reason').fill('Spam in the comments');
      await button('Ban account').click();
      await page.getByRole('tab', { name: 'Moderation' }).click();
      await see('Spam in the comments');
      await shot('owner-moderation-banned', { tall: true });
      await page.getByRole('tab', { name: 'Content' }).click();
      await page.getByLabel('Post ID').fill(reportedPostId);
      await page.getByLabel('Reason').fill('DMCA notice from Example Films, 29 Oct');
      await button('Remove post').click();
      await see('was removed');
      await shot('owner-content');
      await page.getByRole('tab', { name: 'Audit log' }).click();
      await see('remove post');
      await see('add blocked term');
      await see('resolve ranked dispute');
      await shot('owner-audit-log');
      await page.goBack();
    });

    await step('sign out from Clerk, banned sign-in, sign in again', async () => {
      // Signing out inside Clerk's account screen ends the session: the app
      // goes back to sign-in and clears this device's data.
      await openSettings();
      await button('Account and security').click();
      await see('Email addresses');
      // Settings' own Sign out row stays in the page under this screen, before it.
      await page.getByRole('button', { name: 'Sign out', exact: true }).locator('visible=true').last().click();
      await page.getByLabel('Email').waitFor();
      // Tomás was banned in the owner panel.
      await page.getByLabel('Email').fill('tomas_ruiz@example.com');
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await button('Continue').click();
      await see('This account is banned from MatIQ');
      await shot('sign-in-banned');
      // Signed in, but the account doesn't open (three failures: the first
      // try and the two automatic retries): the error screen, then Try again.
      await page.evaluate(() => {
        window.__PREVIEW_FAIL_REGISTER = 3;
      });
      await page.getByLabel('Email').fill(EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await button('Continue').click();
      await see("your MatIQ account didn't open");
      await see('(error 42501)');
      await shot('sign-in-account-error');
      await button('Try again').click();
      // Sam's "Three takedowns" post was removed in the owner panel.
      await see('rear naked choke');
    });

    await step('lift a ban', async () => {
      await tab('Profile').click();
      await button('Owner panel').click();
      await page.getByRole('tab', { name: 'Moderation' }).click();
      await see('Spam in the comments');
      await button('Lift ban').click();
      await see('Nobody is banned.');
      await page.goBack();
    });

    await step('three strikes ban an account', async () => {
      await openSettings();
      await button('Sign out').click();
      // One failed attempt to open the account is retried without showing an error.
      await page.evaluate(() => {
        window.__PREVIEW_FAIL_REGISTER = 1;
      });
      await page.getByLabel('Email').fill('sam_okafor@example.com');
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await button('Continue').click();
      await see('Before you continue');
      await button('Continue').click();
      await page.getByRole('radio', { name: 'March' }).click();
      await page.getByLabel('Birth year').fill('1998');
      await button('Continue').click();
      await page.getByRole('checkbox', { name: /^I agree/ }).click();
      await button('Continue').click();
      await tab('Matches').click();
      await matchLink('Room wrestling').click();
      await button('Share to feed').click();
      await see('Share your scorecard');
      for (const caption of ['nudes', 'k y s', 'sieg heil']) {
        await page.getByLabel('Caption').fill(caption);
        await button('Post').click();
        if (caption !== 'sieg heil') await see("This post wasn't shared");
      }
      // The banned screen replaces the app (not just the error on Share).
      await see("or the network you're connected to", 15_000);
      await shot('banned', { tall: true });
      await button('Sign out').click();
      await page.getByLabel('Email').waitFor();
    });

    await step('sign-up age check (COPPA)', async () => {
      // Clerk's AuthView signs the person up; MatIQ's age check comes next.
      await button("Don't have an account? Sign up").click();
      await see('Create your account');
      await shot('sign-up');
      await field('Email').fill('young@example.test');
      await field('Password').fill('Young-Fighter-2026!');
      await button('Continue').click();
      await see('Verify your email');
      await field('Code').fill('123456');
      await button('Continue').click();
      await see('Before you continue');
      await page.getByRole('radio', { name: 'January' }).locator('visible=true').first().click();
      await field('Birth year').fill(String(new Date().getFullYear() - 8));
      await page.getByRole('checkbox', { name: /^I agree/ }).locator('visible=true').first().click();
      await button('Continue').click();
      // Under 13: the account is deleted, this device is locked, and sign-in says so.
      await see("we couldn't create a MatIQ account");
      await shot('sign-in-after-age-check');
    });

    await step('too old a version: update required', async () => {
      // As if the server's minimum were newer than this build.
      await page.addInitScript(() => {
        window.__PREVIEW_MIN_VERSION = '9.0.0';
      });
      await page.goto(url);
      await see('Update MatIQ');
      await see('is no longer supported');
      await shot('update-required');
    });
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${steps.length} screenshots in ${OUT}`);
  fs.writeFileSync(path.join(OUT, 'a11y-report.json'), `${JSON.stringify(a11y, null, 2)}\n`);
  if (a11y.length > 0) {
    const count = a11y.reduce((total, entry) => total + entry.violations.length, 0);
    console.error(`\n${count} WCAG 2.2 AA violation(s) on ${a11y.length} screen(s):`);
    for (const entry of a11y) {
      for (const v of entry.violations) console.error(`  ${entry.screen}: [${v.impact}] ${v.id} - ${v.help} (${v.nodes[0]?.target ?? ''})`);
    }
    process.exitCode = 1;
  } else {
    console.log('No WCAG 2.2 AA violations found by axe-core.');
  }
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
