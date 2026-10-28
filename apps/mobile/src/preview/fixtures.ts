/**
 * Sample data for the browser UI preview: a small gym with friends, public
 * and private athletes, analysed matches (scored by the real rules engine),
 * feed posts and a ranked ladder in every state. Nothing here ships in the
 * iOS/Android app; it is only reachable from *.web.ts files.
 */

import {
  analyzeMatch,
  type Discipline,
  emptyCareerTotals,
  type CareerTotals,
  unlockedTitles,
} from '@matiq/rules-engine';
import { LEGAL_VERSIONS } from '@/features/legal/documents';

// Preview rows are loosely typed: the fake backend mirrors table shapes, not TS types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface PreviewDb {
  users: Row[];
  profiles: Row[];
  user_entitlements: Row[];
  legal_acceptances: Row[];
  friendships: Row[];
  blocks: Row[];
  matches: Row[];
  match_analyses: Row[];
  match_live_batches: Row[];
  posts: Row[];
  post_likes: Row[];
  usage_ledger: Row[];
  ranked_matches: Row[];
  ranked_ratings: Row[];
  rating_history: Row[];
  user_titles: Row[];
  api_keys: Row[];
  audit_log: Row[];
  mfa_factors: Row[];
  storage: Record<string, Set<string>>;
}

export const PREVIEW_PASSWORD = 'matiq-preview';
export const DEMO_EMAIL = 'demo@matiq.app';

const s = (seconds: number) => seconds * 1000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

/** Deterministic UUID-shaped ids, readable in tests. */
const id = (prefix: string, n: number) => `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const USERS = {
  alex: id('a1e10000', 1),
  jordan: id('b0000000', 2),
  sam: id('c0000000', 3),
  maya: id('d0000000', 4),
  diego: id('e0000000', 5),
  priya: id('f0000000', 6),
  kenji: id('a2000000', 7),
  lena: id('a3000000', 8),
  tomas: id('a4000000', 9),
  aisha: id('a5000000', 10),
  marcus: id('a6000000', 11),
  ivy: id('a7000000', 12),
} as const;

type UserKey = keyof typeof USERS;

const PEOPLE: Record<UserKey, { username: string; name: string; bio: string; visibility: 'public' | 'private'; discipline: Discipline }> = {
  alex: { username: 'alex_rivera', name: 'Alex Rivera', bio: 'Purple belt, folkstyle background. Morning open mats.', visibility: 'public', discipline: 'bjj' },
  jordan: { username: 'jordan_lee', name: 'Jordan Lee', bio: 'Guard player. Always up for rounds.', visibility: 'private', discipline: 'bjj' },
  sam: { username: 'sam_okafor', name: 'Sam Okafor', bio: 'D1 wrestler turned grappler.', visibility: 'public', discipline: 'wrestling' },
  maya: { username: 'maya_chen', name: 'Maya Chen', bio: 'Amateur MMA, 6-1. Muay Thai first.', visibility: 'public', discipline: 'mma' },
  diego: { username: 'diego_santos', name: 'Diego Santos', bio: 'Blue belt, leg lock nerd.', visibility: 'public', discipline: 'bjj' },
  priya: { username: 'priya_patel', name: 'Priya Patel', bio: 'Competitor. Private account.', visibility: 'private', discipline: 'bjj' },
  kenji: { username: 'kenji_w', name: 'Kenji Watanabe', bio: 'Judo black belt learning BJJ.', visibility: 'public', discipline: 'bjj' },
  lena: { username: 'lena_novak', name: 'Lena Novak', bio: 'Freestyle wrestling coach.', visibility: 'public', discipline: 'wrestling' },
  tomas: { username: 'tomas_ruiz', name: 'Tomás Ruiz', bio: 'No-gi only.', visibility: 'public', discipline: 'bjj' },
  aisha: { username: 'aisha_bello', name: 'Aisha Bello', bio: 'MMA, southpaw.', visibility: 'public', discipline: 'mma' },
  marcus: { username: 'marcus_reed', name: 'Marcus Reed', bio: 'Pressure passing enjoyer.', visibility: 'public', discipline: 'bjj' },
  ivy: { username: 'ivy_park', name: 'Ivy Park', bio: 'Brown belt, gym owner.', visibility: 'public', discipline: 'bjj' },
};

// Scripted rounds ------------------------------------------------------------------

function bjjEvents(): unknown[] {
  return [
    { type: 'position', position: 'standing', t: 0, endT: s(25), confidence: 0.92 },
    { type: 'takedown', athlete: 'A', t: s(25), confidence: 0.9 },
    { type: 'position', position: 'closed_guard', athlete: 'B', t: s(26), endT: s(80), confidence: 0.9 },
    { type: 'submission_attempt', athlete: 'B', t: s(55), technique: 'triangle choke', depth: 'deep', confidence: 0.82 },
    { type: 'guard_pass', athlete: 'A', t: s(80), confidence: 0.88 },
    { type: 'position', position: 'side_control', athlete: 'A', t: s(80), endT: s(110), confidence: 0.9 },
    { type: 'position', position: 'mount', athlete: 'A', t: s(110), endT: s(150), confidence: 0.91 },
    { type: 'submission_attempt', athlete: 'A', t: s(140), technique: 'armbar', depth: 'near_finish', confidence: 0.86 },
    { type: 'escape', athlete: 'B', t: s(150), confidence: 0.8 },
    { type: 'position', position: 'half_guard', athlete: 'B', t: s(151), endT: s(200), confidence: 0.85 },
    { type: 'sweep', athlete: 'B', t: s(200), confidence: 0.84 },
    { type: 'position', position: 'half_guard', athlete: 'A', t: s(201), endT: s(240), confidence: 0.83 },
    { type: 'position', position: 'scramble', t: s(240), endT: s(245), confidence: 0.8 },
    { type: 'position', position: 'back_control', athlete: 'A', t: s(245), endT: s(290), confidence: 0.9 },
    { type: 'submission', athlete: 'A', t: s(290), technique: 'rear naked choke', confidence: 0.95 },
  ];
}

function wrestlingEvents(): unknown[] {
  return [
    { type: 'shot_attempt', athlete: 'B', t: s(20), confidence: 0.85 },
    { type: 'takedown', athlete: 'A', t: s(35), confidence: 0.9 },
    { type: 'control', athlete: 'A', t: s(35), endT: s(80), confidence: 0.88 },
    { type: 'near_fall', athlete: 'A', t: s(60), endT: s(64), confidence: 0.86 },
    { type: 'escape', athlete: 'B', t: s(80), confidence: 0.85 },
    { type: 'takedown', athlete: 'B', t: s(120), confidence: 0.88 },
    { type: 'control', athlete: 'B', t: s(120), endT: s(150), confidence: 0.86 },
    { type: 'reversal', athlete: 'A', t: s(150), confidence: 0.84 },
    { type: 'control', athlete: 'A', t: s(150), endT: s(240), confidence: 0.88 },
    { type: 'escape', athlete: 'B', t: s(240), confidence: 0.85 },
    { type: 'shot_attempt', athlete: 'A', t: s(270), confidence: 0.82 },
    { type: 'takedown', athlete: 'A', t: s(300), confidence: 0.9 },
    { type: 'control', athlete: 'A', t: s(300), endT: s(355), confidence: 0.88 },
  ];
}

function mmaEvents(): unknown[] {
  const events: unknown[] = [];
  const strike = (athlete: 'A' | 'B', t: number, landed: boolean, target: string, kind: string, position = 'distance') =>
    events.push({ type: 'strike', athlete, t: s(t), landed, significant: true, target, kind, position, confidence: 0.88 });
  // Round 1: A outlands B at distance.
  for (let t = 10; t < 280; t += 18) strike('A', t, t % 36 !== 10, t % 54 === 10 ? 'body' : 'head', t % 72 === 10 ? 'kick' : 'punch');
  for (let t = 15; t < 280; t += 30) strike('B', t, t % 60 === 15, 'head', 'punch');
  // Round 2: B takes it down and controls.
  events.push({ type: 'takedown', athlete: 'B', t: s(330), landed: true, confidence: 0.9 });
  events.push({ type: 'control', athlete: 'B', t: s(330), endT: s(480), position: 'ground_top', confidence: 0.88 });
  for (let t = 340; t < 480; t += 12) strike('B', t, true, 'head', 'elbow', 'ground');
  events.push({ type: 'submission_attempt', athlete: 'B', t: s(470), technique: 'arm triangle', depth: 'shallow', confidence: 0.8 });
  for (let t = 500; t < 590; t += 20) strike('A', t, true, 'legs', 'kick');
  // Round 3: A knocks B down and dominates.
  for (let t = 610; t < 880; t += 14) strike('A', t, t % 28 !== 610 % 28, t % 42 === 0 ? 'body' : 'head', 'punch');
  events.push({ type: 'knockdown', athlete: 'A', t: s(700), confidence: 0.9 });
  events.push({ type: 'takedown', athlete: 'A', t: s(760), landed: true, confidence: 0.88 });
  events.push({ type: 'control', athlete: 'A', t: s(760), endT: s(860), position: 'ground_top', confidence: 0.86 });
  for (let t = 620; t < 880; t += 35) strike('B', t, t % 70 === 620 % 70, 'head', 'punch');
  return events;
}

const SCRIPTS: Record<Discipline, () => unknown[]> = { bjj: bjjEvents, wrestling: wrestlingEvents, mma: mmaEvents };
const SCRIPT_LENGTH: Record<Discipline, number> = { bjj: s(300), wrestling: s(360), mma: s(900) };

/**
 * Events for a new preview analysis: the discipline's script stretched or
 * compressed to the recording length, so any recording yields a full card.
 */
export function syntheticEvents(discipline: Discipline, durationMs: number): unknown[] {
  const scale = durationMs / SCRIPT_LENGTH[discipline];
  return SCRIPTS[discipline]().map((event) => {
    const e = event as Row;
    return { ...e, t: Math.round(e.t * scale), ...(e.endT !== undefined ? { endT: Math.max(Math.round(e.t * scale) + 1, Math.round(e.endT * scale)) } : {}) };
  });
}

export function scorecardFor(discipline: Discipline, variant: string, durationMs: number, swap = false) {
  let events = syntheticEvents(discipline, durationMs);
  if (swap) events = events.map((event) => ({ ...(event as Row), ...((event as Row).athlete ? { athlete: (event as Row).athlete === 'A' ? 'B' : 'A' } : {}) }));
  const scorecard = analyzeMatch(discipline, events, { durationMs, variant, ...(discipline === 'mma' ? { roundDurationMs: s(300) } : {}) });
  return { events, scorecard };
}

const COACHING: Record<Discipline, string> = {
  bjj: 'Great top pressure after the pass: you held side control long enough to score and moved to mount calmly. When they recovered half guard, your weight drifted back and they swept you; stay heavy on the cross-face. The back take off the scramble was the round winner.',
  wrestling: 'Your setups on the first two takedowns were excellent, and the 4-second near fall decided the period. You gave up an escape twice from the top: keep your hips lower and chop the near arm sooner. Riding time earned you a point.',
  mma: 'You won rounds 1 and 3 on volume and the knockdown. Round 2 was lost on the ground: your takedown defence against the double-leg needs earlier sprawls. Your leg kicks at the end of round 2 slowed them down noticeably.',
};

// Builder --------------------------------------------------------------------------

export function createFixtures(): PreviewDb {
  const db: PreviewDb = {
    users: [],
    profiles: [],
    user_entitlements: [],
    legal_acceptances: [],
    friendships: [],
    blocks: [],
    matches: [],
    match_analyses: [],
    match_live_batches: [],
    posts: [],
    post_likes: [],
    usage_ledger: [],
    ranked_matches: [],
    ranked_ratings: [],
    rating_history: [],
    user_titles: [],
    api_keys: [],
    audit_log: [],
    mfa_factors: [],
    storage: { 'match-videos': new Set(), 'match-frames': new Set(), avatars: new Set() },
  };

  (Object.keys(USERS) as UserKey[]).forEach((key, index) => {
    const person = PEOPLE[key];
    const uid = USERS[key];
    db.users.push({
      id: uid,
      email: key === 'alex' ? DEMO_EMAIL : `${person.username}@example.com`,
      created_at: daysAgo(120 - index * 7),
      last_sign_in_at: minutesAgo(30 + index * 90),
    });
    db.profiles.push({
      id: uid,
      username: person.username,
      display_name: person.name,
      bio: person.bio,
      avatar_path: `${uid}/avatar.jpg`,
      primary_discipline: person.discipline,
      visibility: person.visibility,
      created_at: daysAgo(120 - index * 7),
    });
    db.storage.avatars!.add(`${uid}/avatar.jpg`);
    db.user_entitlements.push({
      user_id: uid,
      role: key === 'alex' ? 'owner' : 'user',
      is_unlimited: key === 'ivy',
      monthly_analysis_limit: 10,
      max_video_seconds: 600,
      is_suspended: false,
      suspended_reason: null,
    });
  });

  // The demo account accepted an older Privacy Policy, so the consent gate shows once.
  db.legal_acceptances.push(
    { user_id: USERS.alex, document: 'terms', version: LEGAL_VERSIONS.terms, accepted_at: daysAgo(30) },
    { user_id: USERS.alex, document: 'privacy', version: '2026-10-23', accepted_at: daysAgo(30) },
  );

  const friendship = (a: string, b: string, requestedBy: string, status: 'pending' | 'accepted', days: number) =>
    db.friendships.push({ user_low: a < b ? a : b, user_high: a < b ? b : a, requested_by: requestedBy, status, created_at: daysAgo(days) });
  friendship(USERS.alex, USERS.jordan, USERS.alex, 'accepted', 60);
  friendship(USERS.alex, USERS.sam, USERS.sam, 'accepted', 45);
  friendship(USERS.alex, USERS.diego, USERS.diego, 'pending', 1);
  friendship(USERS.alex, USERS.kenji, USERS.alex, 'pending', 2);
  friendship(USERS.jordan, USERS.priya, USERS.jordan, 'accepted', 20);

  // Matches with analyses ----------------------------------------------------------
  let matchSeq = 0;
  const addMatch = (input: {
    owner: string;
    discipline: Discipline;
    variant: string;
    title: string;
    a: string;
    b: string;
    daysAgo: number;
    swap?: boolean;
    status?: 'completed' | 'failed';
  }) => {
    const matchId = id('00a0c000', ++matchSeq);
    const durationMs = SCRIPT_LENGTH[input.discipline];
    db.matches.push({
      id: matchId,
      owner_id: input.owner,
      discipline: input.discipline,
      variant: input.variant,
      title: input.title,
      athlete_a_label: input.a,
      athlete_b_label: input.b,
      source: matchSeq % 2 ? 'live' : 'upload',
      status: input.status ?? 'completed',
      duration_ms: durationMs,
      round_duration_ms: input.discipline === 'mma' ? s(300) : null,
      has_video: false,
      error_code: input.status === 'failed' ? 'ai_unavailable' : null,
      frame_count: 120,
      recorded_at: daysAgo(input.daysAgo),
      created_at: daysAgo(input.daysAgo),
    });
    if (input.status !== 'failed') {
      const { events, scorecard } = scorecardFor(input.discipline, input.variant, durationMs, input.swap);
      db.match_analyses.push({
        match_id: matchId,
        owner_id: input.owner,
        events,
        scorecard,
        coaching_summary: COACHING[input.discipline],
        model: 'claude-opus-5-5',
        ruleset_version: scorecard.rulesetVersion,
        created_at: daysAgo(input.daysAgo),
      });
    }
    return matchId;
  };

  const alexBjj = addMatch({ owner: USERS.alex, discipline: 'bjj', variant: 'ibjjf', title: 'Tuesday open mat', a: 'Alex', b: 'Jordan', daysAgo: 1 });
  addMatch({ owner: USERS.alex, discipline: 'wrestling', variant: 'folkstyle', title: 'Live goes with Sam', a: 'Alex', b: 'Sam', daysAgo: 4 });
  addMatch({ owner: USERS.alex, discipline: 'mma', variant: 'unified', title: 'Sparring: 3 x 5', a: 'Alex', b: 'Maya', daysAgo: 9 });
  addMatch({ owner: USERS.alex, discipline: 'bjj', variant: 'ibjjf_reversals', title: 'Comp prep round', a: 'Alex', b: 'Kenji', daysAgo: 12, status: 'failed' });
  const samMatch = addMatch({ owner: USERS.sam, discipline: 'wrestling', variant: 'folkstyle', title: 'Room wrestling', a: 'Sam', b: 'Chris', daysAgo: 2 });
  const mayaMatch = addMatch({ owner: USERS.maya, discipline: 'mma', variant: 'unified', title: 'Fight camp week 4', a: 'Maya', b: 'Aisha', daysAgo: 3 });
  const jordanRanked = addMatch({ owner: USERS.jordan, discipline: 'bjj', variant: 'ibjjf', title: 'Ranked: Jordan vs Alex', a: 'Jordan', b: 'Alex', daysAgo: 0.2 });
  const disputedMatch = addMatch({ owner: USERS.maya, discipline: 'bjj', variant: 'ibjjf', title: 'Ranked: Maya vs Priya', a: 'Maya', b: 'Priya', daysAgo: 1.5, swap: true });

  // Feed -----------------------------------------------------------------------------
  let postSeq = 0;
  const addPost = (author: string, matchId: string | null, body: string, minutes: number, highlight?: [number, number]) => {
    const postId = id('0000b057', ++postSeq);
    db.posts.push({
      id: postId,
      author_id: author,
      match_id: matchId,
      body,
      friends_only: false,
      highlight_start_ms: highlight?.[0] ?? null,
      highlight_end_ms: highlight?.[1] ?? null,
      created_at: minutesAgo(minutes),
    });
    return postId;
  };
  const samPost = addPost(USERS.sam, samMatch, 'Three takedowns and a 4-count near fall. The chain wrestling drills are paying off.', 95, [s(55), s(65)]);
  const alexPost = addPost(USERS.alex, alexBjj, 'Finally finished the rear naked choke off the scramble. Back takes are coming together.', 300, [s(240), s(292)]);
  addPost(USERS.maya, mayaMatch, 'Round 3 was the best I have looked all camp. Leg kicks are landing.', 1500, [s(690), s(705)]);
  addPost(USERS.kenji, null, 'Anyone around for gi rounds Saturday morning?', 2600);
  db.post_likes.push(
    { post_id: alexPost, user_id: USERS.sam, created_at: minutesAgo(200) },
    { post_id: alexPost, user_id: USERS.jordan, created_at: minutesAgo(180) },
    { post_id: samPost, user_id: USERS.jordan, created_at: minutesAgo(60) },
  );

  // Usage -----------------------------------------------------------------------------
  for (let i = 0; i < 3; i++) {
    db.usage_ledger.push({ user_id: USERS.alex, units: 1, key_source: 'platform', status: 'committed', created_at: daysAgo(i * 3 + 1) });
  }
  for (const [key, count] of [['sam', 6], ['maya', 9], ['ivy', 22], ['jordan', 4]] as const) {
    for (let i = 0; i < count; i++) db.usage_ledger.push({ user_id: USERS[key], units: 1, key_source: 'platform', status: 'committed', created_at: daysAgo(i % 20) });
  }

  // Ranked ladder -----------------------------------------------------------------------
  const rating = (key: UserKey, discipline: Discipline, value: number, games: number, record: [number, number, number], totals: Partial<CareerTotals> = {}) => {
    const full = { ...emptyCareerTotals(), matches: games, wins: record[0], losses: record[1], draws: record[2], ...totals };
    db.ranked_ratings.push({
      user_id: USERS[key],
      discipline,
      rating: value,
      games,
      wins: record[0],
      losses: record[1],
      draws: record[2],
      current_streak: full.currentStreak,
      peak_rating: Math.max(value, value + 14),
      totals: full,
      version: games,
      last_match_at: daysAgo(2),
    });
    for (const titleId of unlockedTitles(discipline, full, value)) {
      if (!db.user_titles.some((title) => title.user_id === USERS[key] && title.title_id === titleId)) {
        db.user_titles.push({ user_id: USERS[key], title_id: titleId, discipline, ranked_match_id: null, is_featured: false, unlocked_at: daysAgo(10) });
      }
    }
  };
  rating('alex', 'bjj', 1187, 14, [9, 4, 1], { takedowns: 26, sweeps: 11, guardPasses: 9, backTakes: 4, escapes: 7, submissionWins: 3, currentStreak: 3, bestStreak: 4, controlMs: s(1260), biggestUpset: 96 });
  rating('alex', 'wrestling', 1032, 3, [2, 1, 0], { takedowns: 7, escapes: 4, nearFalls: 2, currentStreak: 1, bestStreak: 1, controlMs: s(410) });
  rating('alex', 'mma', 1268, 8, [6, 2, 0], { takedowns: 5, significantLanded: 212, significantAbsorbed: 118, knockdownsScored: 2, koWins: 1, currentStreak: 2, bestStreak: 3 });
  rating('jordan', 'bjj', 1243, 18, [11, 6, 1], { sweeps: 16, submissionWins: 5, takedowns: 4 });
  rating('sam', 'bjj', 1121, 9, [5, 4, 0], { takedowns: 19 });
  rating('sam', 'wrestling', 1318, 22, [16, 6, 0], { takedowns: 48, escapes: 21, fallWins: 3, techFallWins: 2 });
  rating('maya', 'mma', 1402, 15, [12, 3, 0], { significantLanded: 410, significantAbsorbed: 160, koWins: 4 });
  rating('maya', 'bjj', 1356, 12, [9, 3, 0], { submissionWins: 6 });
  rating('diego', 'bjj', 1012, 6, [3, 3, 0]);
  rating('priya', 'bjj', 1502, 31, [25, 6, 0], { submissionWins: 14, sweeps: 30, guardPasses: 22, backTakes: 12 });
  rating('kenji', 'bjj', 1090, 7, [4, 3, 0], { takedowns: 25 });
  rating('lena', 'wrestling', 1455, 27, [21, 6, 0], { takedowns: 60, fallWins: 5 });
  rating('tomas', 'bjj', 1264, 16, [10, 6, 0]);
  rating('aisha', 'mma', 1189, 10, [6, 4, 0]);
  rating('marcus', 'bjj', 1301, 20, [13, 7, 0], { guardPasses: 31 });
  rating('ivy', 'bjj', 1534, 40, [33, 6, 1], { submissionWins: 18, sweeps: 25, backTakes: 15, escapes: 22 });
  const featured = db.user_titles.find((title) => title.user_id === USERS.alex && title.title_id === 'takedown_machine');
  if (featured) featured.is_featured = true;

  let rankedSeq = 0;
  const ranked = (row: Row) => {
    const rankedId = id('0a0ced00', ++rankedSeq);
    db.ranked_matches.push({
      id: rankedId,
      message: null,
      match_id: null,
      fighter_a_id: null,
      fighter_b_id: null,
      winner_id: null,
      result_method: null,
      confirmed_a_at: null,
      confirmed_b_at: null,
      confirm_by: null,
      recorded_at: null,
      dispute_reason: null,
      disputed_by: null,
      rating_a_before: null,
      rating_a_after: null,
      rating_b_before: null,
      rating_b_after: null,
      expires_at: hoursFromNow(24 * 6),
      created_at: minutesAgo(120),
      responded_at: null,
      settled_at: null,
      ...row,
    });
    return rankedId;
  };
  ranked({ discipline: 'bjj', variant: 'ibjjf', challenger_id: USERS.diego, opponent_id: USERS.alex, status: 'pending', message: 'Open mat Thursday? Gi, 6 minutes.', created_at: minutesAgo(40) });
  ranked({ discipline: 'wrestling', variant: 'folkstyle', challenger_id: USERS.alex, opponent_id: USERS.sam, status: 'accepted', responded_at: minutesAgo(300), created_at: daysAgo(1) });
  ranked({
    discipline: 'bjj',
    variant: 'ibjjf',
    challenger_id: USERS.jordan,
    opponent_id: USERS.alex,
    status: 'awaiting_confirmation',
    match_id: jordanRanked,
    fighter_a_id: USERS.jordan,
    fighter_b_id: USERS.alex,
    winner_id: USERS.jordan,
    result_method: 'submission',
    confirmed_a_at: minutesAgo(200),
    recorded_at: minutesAgo(240),
    confirm_by: hoursFromNow(68),
    created_at: daysAgo(2),
  });
  ranked({
    discipline: 'mma',
    variant: 'unified',
    challenger_id: USERS.maya,
    opponent_id: USERS.alex,
    status: 'confirmed',
    fighter_a_id: USERS.alex,
    fighter_b_id: USERS.maya,
    winner_id: USERS.alex,
    result_method: 'decision',
    rating_a_before: 1250,
    rating_a_after: 1268,
    rating_b_before: 1420,
    rating_b_after: 1402,
    settled_at: daysAgo(6),
    created_at: daysAgo(9),
  });
  ranked({
    discipline: 'bjj',
    variant: 'ibjjf',
    challenger_id: USERS.alex,
    opponent_id: USERS.sam,
    status: 'confirmed',
    fighter_a_id: USERS.sam,
    fighter_b_id: USERS.alex,
    winner_id: USERS.sam,
    result_method: 'points',
    rating_a_before: 1107,
    rating_a_after: 1121,
    rating_b_before: 1201,
    rating_b_after: 1187,
    settled_at: daysAgo(14),
    created_at: daysAgo(16),
  });
  ranked({
    discipline: 'bjj',
    variant: 'ibjjf',
    challenger_id: USERS.priya,
    opponent_id: USERS.maya,
    status: 'disputed',
    match_id: disputedMatch,
    fighter_a_id: USERS.maya,
    fighter_b_id: USERS.priya,
    winner_id: USERS.priya,
    result_method: 'submission',
    recorded_at: daysAgo(1.4),
    confirm_by: hoursFromNow(40),
    dispute_reason: 'The armbar was after the time limit; the round had ended.',
    disputed_by: USERS.maya,
    created_at: daysAgo(3),
  });

  // Owner audit log ----------------------------------------------------------------------
  db.audit_log.push(
    { id: 2, actor_id: USERS.alex, target_user_id: USERS.ivy, action: 'set_unlimited', old_value: { is_unlimited: false }, new_value: { is_unlimited: true }, reason: 'Gym owner partner', created_at: daysAgo(5) },
    { id: 1, actor_id: USERS.alex, target_user_id: USERS.maya, action: 'update_entitlements', old_value: { monthly_analysis_limit: 10 }, new_value: { monthly_analysis_limit: 20 }, reason: 'Fight camp', created_at: daysAgo(12) },
  );

  return db;
}
