/**
 * In-memory stand-in for Supabase used by the browser UI preview.
 *
 * It implements exactly the surface the app calls (tables via a small query
 * builder, RPCs, Edge Functions, auth incl. TOTP, storage and Realtime) and
 * mirrors the server rules that matter for the UI: visibility, the ranked
 * lifecycle and quota counting. Analyses are scored by the real rules engine
 * and ranked results are settled by the real `settleRankedMatch`, so the
 * screens show genuine output. Never bundled into iOS/Android builds.
 */

import {
  analyzeMatch,
  type Discipline,
  newFighterState,
  parseTotals,
  settleRankedMatch,
  type Athlete,
} from '@matiq/rules-engine';
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { meetsMinimumAge } from '@/features/legal/age-rule';
import { LEGAL_VERSIONS } from '@/features/legal/documents';
import { createFixtures, DEMO_EMAIL, PREVIEW_PASSWORD, type Row, syntheticEvents } from './fixtures';

const db = createFixtures();

interface PreviewSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: 'bearer';
  aal: 'aal1' | 'aal2';
  user: { id: string; email: string; created_at: string; factors: Row[] };
}

let session: PreviewSession | null = null;
/** Users who have answered the age check (the real one lives in private.age_checks). */
const ageChecked = new Set<string>();
/**
 * Like the real server (RLS, the pre-request hook, the function middleware):
 * until the age check is answered, only reads are allowed.
 */
const ageCheckPending = () => {
  const viewer = me();
  return viewer !== null && !ageChecked.has(viewer);
};
const AGE_CHECK_REQUIRED = { code: '42501', message: 'age_check_required', details: null, hint: 'Enter your birth month and year first.' };
/** Like the server's pre-request hook: a banned account gets nothing at all. */
const isBanned = (uid: string | null) => uid !== null && db.bans.some((ban) => ban.user_id === uid);
const BANNED = { code: '42501', message: 'banned', details: null, hint: null };
let tokenSeq = 0;
const authListeners = new Set<(event: string, session: PreviewSession | null) => void>();

const latency = (ms = 80) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();
const me = () => session?.user.id ?? null;
let uuidSeq = 1000;
const uuid = () => `0f0f0f0f-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

class PreviewError extends Error {
  readonly code: string;
  readonly hint: string | null;
  constructor(code: string, message: string, hint: string | null = null) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

const fail = (code: string, message: string, hint: string | null = null): never => {
  throw new PreviewError(code, message, hint);
};

function toPostgrestError(error: unknown) {
  if (error instanceof PreviewError) return { code: error.code, message: error.message, details: null, hint: error.hint };
  return { code: 'XX000', message: error instanceof Error ? error.message : 'preview backend error', details: null, hint: null };
}

// Relationships and visibility ------------------------------------------------------

const profileOf = (uid: string) => db.profiles.find((profile) => profile.id === uid);
const entitlementsOf = (uid: string) => db.user_entitlements.find((row) => row.user_id === uid)!;
const pairKey = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

function friendshipOf(a: string, b: string) {
  const [low, high] = pairKey(a, b);
  return db.friendships.find((row) => row.user_low === low && row.user_high === high);
}

const areFriends = (a: string, b: string) => friendshipOf(a, b)?.status === 'accepted';
const blocked = (a: string, b: string) => db.blocks.some((row) => (row.blocker_id === a && row.blocked_id === b) || (row.blocker_id === b && row.blocked_id === a));

function canViewAuthor(viewer: string | null, author: string, friendsOnly = false): boolean {
  if (!viewer) return false;
  if (viewer === author) return true;
  if (isBanned(author)) return false;
  if (blocked(viewer, author)) return false;
  if (!friendsOnly && profileOf(author)?.visibility === 'public') return true;
  return areFriends(viewer, author);
}

const isOwner = (uid: string | null) => uid !== null && entitlementsOf(uid)?.role === 'owner';

function canViewMatch(viewer: string | null, match: Row): boolean {
  if (!viewer) return false;
  if (match.owner_id === viewer) return true;
  if (db.posts.some((post) => post.match_id === match.id && canViewAuthor(viewer, post.author_id, post.friends_only))) return true;
  return db.ranked_matches.some(
    (ranked) =>
      ranked.match_id === match.id && ([ranked.fighter_a_id, ranked.fighter_b_id].includes(viewer) || (ranked.status === 'disputed' && isOwner(viewer))),
  );
}

function visible(table: string, row: Row, viewer: string | null): boolean {
  switch (table) {
    case 'profiles':
      return viewer !== null && !blocked(viewer, row.id) && (row.id === viewer || !isBanned(row.id));
    case 'posts':
      return (row.moderation == null || row.author_id === viewer) && canViewAuthor(viewer, row.author_id, row.friends_only);
    case 'matches':
      return canViewMatch(viewer, row);
    case 'match_analyses': {
      const match = db.matches.find((m) => m.id === row.match_id);
      return match ? canViewMatch(viewer, match) : false;
    }
    case 'ranked_matches':
      return viewer !== null && [row.challenger_id, row.opponent_id].includes(viewer);
    case 'ranked_ratings':
    case 'user_titles':
      return canViewAuthor(viewer, row.user_id);
    case 'rating_history':
    case 'legal_acceptances':
    case 'usage_ledger':
      return row.user_id === viewer;
    case 'match_live_batches':
      return row.owner_id === viewer;
    default:
      return viewer !== null;
  }
}

// Realtime --------------------------------------------------------------------------

interface Listener {
  table: string;
  filter?: string;
  callback: (payload: { eventType: string; new: Row; old: Row }) => void;
}

class PreviewChannel {
  readonly listeners: Listener[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  on(_type: string, config: { table: string; filter?: string }, callback: Listener['callback']) {
    this.listeners.push({ table: config.table, filter: config.filter, callback });
    return this;
  }
  subscribe() {
    channels.add(this);
    return this;
  }
  unsubscribe() {
    channels.delete(this);
    return Promise.resolve('ok');
  }
}

const channels = new Set<PreviewChannel>();

function emit(table: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Row) {
  for (const channel of channels) {
    for (const listener of channel.listeners) {
      if (listener.table !== table) continue;
      if (!visible(table, row, me())) continue;
      if (listener.filter) {
        const [column, rest] = listener.filter.split('=eq.');
        if (column && String(row[column]) !== rest) continue;
      }
      setTimeout(() => listener.callback({ eventType, new: row, old: row }), 0);
    }
  }
}

// Query builder ---------------------------------------------------------------------

type Filter = (row: Row) => boolean;
type TableName = Exclude<keyof typeof db, 'storage'>;
const tableRows = (table: string): Row[] => (db as unknown as Record<string, Row[] | undefined>)[table] ?? fail('42P01', `relation ${table} does not exist`);

class QueryBuilder implements PromiseLike<{ data: unknown; error: unknown; count?: number | null }> {
  private readonly filters: Filter[] = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private values: Row | Row[] | null = null;
  private columns = '*';
  private returning = false;

  private readonly table: TableName;
  constructor(table: TableName) {
    this.table = table;
  }

  select(columns = '*') {
    if (this.action === 'select') this.columns = columns;
    else this.returning = true;
    return this;
  }
  insert(values: Row | Row[]) {
    this.action = 'insert';
    this.values = values;
    return this;
  }
  upsert(values: Row | Row[]) {
    this.action = 'upsert';
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.action = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.action = 'delete';
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderSpec = { column, ascending: options.ascending ?? true };
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private rows(): Row[] {
    return tableRows(this.table);
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    await latency();
    try {
      const data = this.run();
      return { data, error: null };
    } catch (error) {
      return { data: null, error: toPostgrestError(error) };
    }
  }

  private run(): unknown {
    const viewer = me();
    if (!viewer && this.table !== 'profiles') fail('42501', 'permission denied');
    if (isBanned(viewer)) fail('42501', 'banned');
    if (this.action !== 'select' && ageCheckPending()) fail('42501', 'age_check_required');
    switch (this.action) {
      case 'select':
        return this.shape(this.matching(viewer));
      case 'insert':
      case 'upsert': {
        const inserted = (Array.isArray(this.values) ? this.values : [this.values!]).map((value) => insertRow(this.table, value, this.action === 'upsert'));
        return this.returning ? this.shape(inserted.filter(Boolean) as Row[]) : null;
      }
      case 'update': {
        const rows = this.matching(viewer).filter((row) => canWrite(this.table, row, viewer!));
        checkUpdate(this.table, this.values as Row);
        for (const row of rows) {
          Object.assign(row, this.values);
          emit(this.table, 'UPDATE', row);
        }
        return this.returning ? this.shape(rows) : null;
      }
      case 'delete': {
        const rows = this.matching(viewer).filter((row) => canWrite(this.table, row, viewer!));
        for (const row of rows) deleteRow(this.table, row);
        return null;
      }
    }
  }

  private matching(viewer: string | null): Row[] {
    let rows = this.rows().filter((row) => visible(this.table, row, viewer) && this.filters.every((filter) => filter(row)));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      rows = [...rows].sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private shape(rows: Row[]): unknown {
    const embedAnalyses = this.table === 'matches' && this.columns.includes('match_analyses(');
    const out = rows.map((row) => {
      const copy = structuredClone(row);
      if (embedAnalyses) copy.match_analyses = db.match_analyses.filter((analysis) => analysis.match_id === row.id).map((analysis) => structuredClone(analysis));
      return copy;
    });
    if (this.mode === 'many') return out;
    if (out.length === 0) return this.mode === 'maybe' ? null : fail('PGRST116', 'JSON object requested, multiple (or no) rows returned');
    return out[0];
  }
}

function canWrite(table: string, row: Row, viewer: string): boolean {
  switch (table) {
    case 'profiles':
      return row.id === viewer;
    case 'matches':
      return row.owner_id === viewer;
    case 'posts':
      return row.author_id === viewer;
    case 'post_likes':
      return row.user_id === viewer;
    case 'blocks':
      return row.blocker_id === viewer;
    default:
      return false;
  }
}

// Moderation (mirrors supabase/migrations/20261029000500_moderation.sql) ----------------

/** Lower case, look-alike characters swapped, spelled-out letters joined. */
function normalizeForFilter(text: string): string {
  const swapped = text.toLowerCase().replace(/[013457@$]/g, (ch) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' })[ch]!);
  return swapped
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b([a-z0-9]) (?=[a-z0-9]\b)/g, '$1')
    .trim();
}

function textViolation(text: string | null | undefined): string | null {
  if (!text) return null;
  const normal = normalizeForFilter(text);
  const squeezed = normal.replace(/([a-z])\1+/g, '$1');
  for (const { term, category } of db.blocked_terms) {
    const pattern = new RegExp(`\\b${term.replace(/\*$/, '').replace(/ /g, '\\s*')}${term.endsWith('*') ? '[a-z0-9]*' : ''}\\b`);
    if (pattern.test(normal) || pattern.test(squeezed)) return category;
  }
  return null;
}

const FILTERED_COLUMNS: Record<string, string[]> = {
  profiles: ['username', 'display_name', 'bio'],
  matches: ['title', 'athlete_a_label', 'athlete_b_label'],
};

function checkUpdate(table: string, values: Row) {
  if ((FILTERED_COLUMNS[table] ?? []).some((column) => textViolation(values[column]))) fail('22023', 'content_not_allowed');
  // Only the moderation function publishes a profile picture.
  if (table === 'profiles' && values.avatar_path) fail('42501', 'avatar_requires_review');
}

function banUser(userId: string, reason: string, category: string, source: 'owner' | 'automatic') {
  if (entitlementsOf(userId)?.role === 'owner') fail('22023', 'the owner account cannot be banned');
  const e = entitlementsOf(userId);
  const earlier = db.bans.find((ban) => ban.user_id === userId);
  const prior = earlier ? { prior_suspended: earlier.prior_suspended, prior_suspended_reason: earlier.prior_suspended_reason } : { prior_suspended: Boolean(e?.is_suspended), prior_suspended_reason: e?.suspended_reason ?? null };
  db.bans = db.bans.filter((ban) => ban.user_id !== userId);
  db.bans.unshift({ user_id: userId, reason, category, source, created_at: now(), ...prior });
  if (e) Object.assign(e, { is_suspended: true, suspended_reason: `Banned: ${reason}` });
  audit('ban', userId, {}, { category, source }, reason);
}

function recordStrike(userId: string, kind: string, detail: string) {
  db.moderation_strikes.unshift({ user_id: userId, kind, detail: detail.slice(0, 280), created_at: now() });
  const recent = db.moderation_strikes.filter((s) => s.user_id === userId && Date.parse(s.created_at) > Date.now() - 30 * 86_400_000);
  if (recent.length >= 3 && !isBanned(userId) && entitlementsOf(userId)?.role !== 'owner') {
    banUser(userId, 'Automatic: three posts that broke the community rules in 30 days', 'text', 'automatic');
  }
}

function insertRow(table: string, value: Row, upsert: boolean): Row | null {
  const viewer = me()!;
  const rows = tableRows(table);
  let row: Row;
  switch (table) {
    case 'matches':
      if (FILTERED_COLUMNS.matches!.some((column) => textViolation(value[column]))) fail('22023', 'content_not_allowed');
      row = { has_video: false, error_code: null, frame_count: 0, status: 'draft', created_at: now(), recorded_at: now(), ...value, owner_id: viewer };
      break;
    case 'legal_acceptances': {
      row = { ...value, user_id: viewer, accepted_at: now() };
      const exists = rows.some((r) => r.user_id === viewer && r.document === row.document && r.version === row.version);
      if (exists) return upsert ? null : fail('23505', 'duplicate key value');
      break;
    }
    case 'posts': {
      const category = textViolation(value.body);
      row = { id: uuid(), created_at: now(), ...value, author_id: viewer, moderation: category ? 'blocked' : null };
      if (category) recordStrike(viewer, `post:${category}`, String(value.body));
      break;
    }
    case 'post_likes':
      if (rows.some((r) => r.post_id === value.post_id && r.user_id === viewer)) fail('23505', 'duplicate key value');
      row = { ...value, user_id: viewer, created_at: now() };
      break;
    case 'blocks':
      row = { ...value, blocker_id: viewer, created_at: now() };
      db.friendships = db.friendships.filter((f) => !(pairKey(viewer, value.blocked_id).join() === [f.user_low, f.user_high].join()));
      break;
    default:
      return fail('42501', `permission denied for table ${table}`);
  }
  rows.push(row);
  emit(table, 'INSERT', row);
  return row;
}

function deleteRow(table: string, row: Row) {
  const rows = tableRows(table);
  if (table === 'matches') onMatchDeleted(row.id);
  rows.splice(rows.indexOf(row), 1);
  if (table === 'matches') {
    db.match_analyses = db.match_analyses.filter((analysis) => analysis.match_id !== row.id);
    db.posts = db.posts.filter((post) => post.match_id !== row.id);
  }
  emit(table, 'DELETE', row);
}

// Ranked rules (mirrors 20261028000100_ranked.sql) ----------------------------------

const OPEN = ['pending', 'accepted', 'awaiting_confirmation', 'disputed'];
const rankedById = (rankedId: string) => db.ranked_matches.find((row) => row.id === rankedId) ?? fail('P0002', 'ranked match not found');

function rankedReady(r: Row): boolean {
  if (r.status !== 'awaiting_confirmation') return false;
  if (r.confirmed_a_at && r.confirmed_b_at) return true;
  return Date.parse(r.confirm_by) <= Date.now() && r.winner_id !== r.fighter_a_id;
}

function onMatchCompleted(matchId: string) {
  const r = db.ranked_matches.find((row) => row.match_id === matchId && row.status === 'accepted');
  if (!r) return;
  const analysis = db.match_analyses.find((row) => row.match_id === matchId);
  const winner = analysis?.scorecard.result.winner as Athlete | null;
  Object.assign(r, {
    status: 'awaiting_confirmation',
    winner_id: winner === 'A' ? r.fighter_a_id : winner === 'B' ? r.fighter_b_id : null,
    result_method: analysis?.scorecard.result.method ?? null,
    recorded_at: now(),
    confirm_by: new Date(Date.now() + 72 * 3_600_000).toISOString(),
  });
  emit('ranked_matches', 'UPDATE', r);
}

function onMatchDeleted(matchId: string) {
  for (const r of db.ranked_matches) {
    if (r.match_id !== matchId || !OPEN.includes(r.status)) continue;
    if (r.status === 'accepted') Object.assign(r, { match_id: null, fighter_a_id: null, fighter_b_id: null });
    else Object.assign(r, { status: 'voided', match_id: null });
    emit('ranked_matches', 'UPDATE', r);
  }
}

function ratingRow(uid: string, discipline: Discipline): Row {
  let row = db.ranked_ratings.find((r) => r.user_id === uid && r.discipline === discipline);
  if (!row) {
    const fresh = newFighterState();
    row = { user_id: uid, discipline, rating: fresh.rating, games: 0, wins: 0, losses: 0, draws: 0, current_streak: 0, peak_rating: fresh.peakRating, totals: fresh.totals, version: 0 };
    db.ranked_ratings.push(row);
  }
  return row;
}

function settle(r: Row) {
  if (r.status === 'confirmed') return { id: r.id, status: 'confirmed' };
  if (!rankedReady(r)) fail('not_ready', 'Waiting for confirmation');
  const scorecard = db.match_analyses.find((analysis) => analysis.match_id === r.match_id)?.scorecard ?? fail('invalid_scorecard', 'no scorecard');
  const rowA = ratingRow(r.fighter_a_id, r.discipline);
  const rowB = ratingRow(r.fighter_b_id, r.discipline);
  const state = (row: Row) => ({ rating: row.rating, games: row.games, peakRating: row.peak_rating, totals: parseTotals(row.totals) });
  const settled = settleRankedMatch(scorecard, { A: state(rowA), B: state(rowB) });
  r.rating_a_before = rowA.rating;
  r.rating_b_before = rowB.rating;
  for (const [side, row, opponent] of [['A', rowA, r.fighter_b_id], ['B', rowB, r.fighter_a_id]] as const) {
    const fighter = settled[side];
    const outcome = settled.winner === null ? 'draw' : settled.winner === side ? 'win' : 'loss';
    db.rating_history.push({ user_id: row.user_id, discipline: r.discipline, ranked_match_id: r.id, opponent_id: opponent, outcome, rating_before: row.rating, rating_after: fighter.rating, delta: fighter.change.delta, created_at: now() });
    Object.assign(row, {
      rating: fighter.rating,
      games: fighter.games,
      wins: fighter.totals.wins,
      losses: fighter.totals.losses,
      draws: fighter.totals.draws,
      current_streak: fighter.totals.currentStreak,
      peak_rating: fighter.peakRating,
      totals: fighter.totals,
      version: row.version + 1,
      last_match_at: now(),
    });
    for (const titleId of fighter.titles) {
      if (!db.user_titles.some((title) => title.user_id === row.user_id && title.title_id === titleId)) {
        db.user_titles.push({ user_id: row.user_id, title_id: titleId, discipline: r.discipline, ranked_match_id: r.id, is_featured: false, unlocked_at: now() });
      }
    }
  }
  Object.assign(r, { status: 'confirmed', settled_at: now(), rating_a_after: rowA.rating, rating_b_after: rowB.rating });
  emit('ranked_matches', 'UPDATE', r);
  return { id: r.id, status: 'confirmed' };
}

// Analysis simulation ------------------------------------------------------------------

function usageFor(uid: string) {
  const ent = entitlementsOf(uid);
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const used = db.usage_ledger.filter((row) => row.user_id === uid && row.key_source === 'platform' && row.created_at >= start.toISOString()).length;
  const resets = new Date(start);
  resets.setUTCMonth(resets.getUTCMonth() + 1);
  return {
    used,
    monthly_limit: ent.monthly_analysis_limit,
    is_unlimited: ent.is_unlimited,
    is_suspended: ent.is_suspended,
    max_video_seconds: ent.max_video_seconds,
    period_start: start.toISOString(),
    resets_at: resets.toISOString(),
  };
}

function setMatch(match: Row, patch: Row) {
  Object.assign(match, patch);
  emit('matches', 'UPDATE', match);
}

function startAnalysis(matchId: string, keySource: string) {
  const viewer = me()!;
  const match = db.matches.find((row) => row.id === matchId && row.owner_id === viewer) ?? fail('not_found', 'Not found');
  if (!['draft', 'failed', 'live'].includes(match.status)) fail('invalid_state', 'Match already analysed');
  const usage = usageFor(viewer);
  if (keySource === 'platform' && !usage.is_unlimited && usage.used >= usage.monthly_limit) fail('quota_exceeded', 'Monthly quota used');
  db.usage_ledger.push({ user_id: viewer, units: keySource === 'platform' ? 1 : 0, key_source: keySource, status: 'committed', created_at: now() });
  const frames = [...(db.storage['match-frames'] ?? [])].filter((path) => path.startsWith(`${viewer}/${matchId}/`)).length;
  setMatch(match, { status: 'queued', frame_count: frames, error_code: null });
  setTimeout(() => setMatch(match, { status: 'processing' }), 900);
  setTimeout(() => {
    const discipline = match.discipline as Discipline;
    const events = syntheticEvents(discipline, match.duration_ms);
    const scorecard = analyzeMatch(discipline, events, {
      durationMs: match.duration_ms,
      variant: match.variant,
      ...(match.round_duration_ms ? { roundDurationMs: match.round_duration_ms } : {}),
    });
    db.match_analyses = db.match_analyses.filter((analysis) => analysis.match_id !== matchId);
    db.match_analyses.push({
      match_id: matchId,
      owner_id: viewer,
      events,
      scorecard,
      coaching_summary: 'Preview analysis: these events are generated sample data, scored by the real MatIQ rules engine.',
      model: 'preview',
      ruleset_version: scorecard.rulesetVersion,
      created_at: now(),
    });
    setMatch(match, { status: 'completed' });
    onMatchCompleted(matchId);
  }, 2800);
  return { matchId, status: 'queued', frames, usage: { used: usage.used + 1, monthlyLimit: usage.monthly_limit, isUnlimited: usage.is_unlimited } };
}

// RPCs -------------------------------------------------------------------------------

function feedItem(post: Row, viewer: string) {
  const author = profileOf(post.author_id)!;
  const match = post.match_id ? db.matches.find((m) => m.id === post.match_id) : null;
  const scorecard = match ? db.match_analyses.find((a) => a.match_id === match.id)?.scorecard : null;
  return {
    post_id: post.id,
    author_id: post.author_id,
    username: author.username,
    display_name: author.display_name,
    avatar_path: author.avatar_path,
    body: post.body,
    friends_only: post.friends_only,
    created_at: post.created_at,
    match_id: match?.id ?? null,
    discipline: match?.discipline ?? null,
    variant: match?.variant ?? null,
    match_title: match?.title ?? null,
    athlete_a_label: match?.athlete_a_label ?? null,
    athlete_b_label: match?.athlete_b_label ?? null,
    has_video: match?.has_video ?? false,
    highlight_start_ms: post.highlight_start_ms,
    highlight_end_ms: post.highlight_end_ms,
    result: scorecard?.result ?? null,
    totals: scorecard?.totals ?? null,
    like_count: db.post_likes.filter((like) => like.post_id === post.id).length,
    liked_by_me: db.post_likes.some((like) => like.post_id === post.id && like.user_id === viewer),
  };
}

function relationship(viewer: string, other: string) {
  if (viewer === other) return 'self';
  const f = friendshipOf(viewer, other);
  if (!f) return 'none';
  if (f.status === 'accepted') return 'friend';
  return f.requested_by === viewer ? 'outgoing' : 'incoming';
}

function personRow(uid: string) {
  const p = profileOf(uid)!;
  return { user_id: uid, username: p.username, display_name: p.display_name, avatar_path: p.avatar_path, visibility: p.visibility };
}

function audit(action: string, target: string | null, oldValue: Row, newValue: Row, reason: string | null) {
  db.audit_log.unshift({ id: db.audit_log.length + 1, actor_id: me(), target_user_id: target, action, old_value: oldValue, new_value: newValue, reason, created_at: now() });
}

function adminRow(uid: string) {
  const p = profileOf(uid)!;
  const e = entitlementsOf(uid);
  const user = db.users.find((u) => u.id === uid)!;
  return {
    user_id: uid,
    username: p.username,
    display_name: p.display_name,
    email: user.email,
    role: e.role,
    is_unlimited: e.is_unlimited,
    is_suspended: e.is_suspended,
    monthly_analysis_limit: e.monthly_analysis_limit,
    max_video_seconds: e.max_video_seconds,
    used_this_month: usageFor(uid).used,
    total_analyses: db.usage_ledger.filter((row) => row.user_id === uid).length,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
  };
}

const requireOwner = () => (isOwner(me()) ? me()! : fail('42501', 'not authorized'));

const RPCS: Record<string, (args: Row, viewer: string) => unknown> = {
  am_i_owner: (_args, viewer) => isOwner(viewer),
  my_age_check: (_args, viewer) => ageChecked.has(viewer),
  get_my_usage: (_args, viewer) => [usageFor(viewer)],

  get_feed: ({ p_before, p_limit = 20, p_author, p_friends_only }, viewer) =>
    db.posts
      .filter((post) => (post.moderation == null || post.author_id === viewer) && canViewAuthor(viewer, post.author_id, post.friends_only))
      .filter((post) => !p_author || post.author_id === p_author)
      .filter((post) => !p_friends_only || post.author_id === viewer || areFriends(viewer, post.author_id))
      .filter((post) => !p_before || post.created_at < p_before)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, p_limit)
      .map((post) => feedItem(post, viewer)),

  get_profile: ({ p_user_id }, viewer) => {
    const p = profileOf(p_user_id);
    if (!p || blocked(viewer, p_user_id) || (p_user_id !== viewer && isBanned(p_user_id))) return [];
    const canView = canViewAuthor(viewer, p_user_id);
    return [
      {
        user_id: p.id,
        username: p.username,
        display_name: p.display_name,
        bio: p.bio,
        avatar_path: p.avatar_path,
        primary_discipline: p.primary_discipline,
        visibility: p.visibility,
        relationship: relationship(viewer, p_user_id),
        can_view_content: canView,
        post_count: canView ? db.posts.filter((post) => post.author_id === p_user_id).length : null,
        friend_count: db.friendships.filter((f) => f.status === 'accepted' && [f.user_low, f.user_high].includes(p_user_id)).length,
      },
    ];
  },

  get_friends: (_args, viewer) =>
    db.friendships
      .filter((f) => [f.user_low, f.user_high].includes(viewer))
      .map((f) => {
        const other = f.user_low === viewer ? f.user_high : f.user_low;
        return {
          ...personRow(other),
          status: f.status,
          direction: f.status === 'accepted' ? 'friend' : f.requested_by === viewer ? 'outgoing' : 'incoming',
          since: f.created_at,
        };
      }),

  search_profiles: ({ p_query = '', p_limit = 20 }, viewer) => {
    const q = String(p_query).toLowerCase();
    return db.profiles
      .filter((p) => p.id !== viewer && !blocked(viewer, p.id) && (p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q)))
      .slice(0, p_limit)
      .map((p) => personRow(p.id));
  },

  send_friend_request: ({ p_target }, viewer) => {
    const existing = friendshipOf(viewer, p_target);
    if (existing) {
      if (existing.status === 'pending' && existing.requested_by === p_target) existing.status = 'accepted';
      return existing.status;
    }
    const [low, high] = pairKey(viewer, p_target);
    db.friendships.push({ user_low: low, user_high: high, requested_by: viewer, status: 'pending', created_at: now() });
    return 'pending';
  },
  respond_friend_request: ({ p_requester, p_accept }, viewer) => {
    const f = friendshipOf(viewer, p_requester);
    if (!f || f.status !== 'pending' || f.requested_by !== p_requester) return false;
    if (p_accept) f.status = 'accepted';
    else db.friendships.splice(db.friendships.indexOf(f), 1);
    return true;
  },
  remove_friend: ({ p_other }, viewer) => {
    const f = friendshipOf(viewer, p_other);
    if (f) db.friendships.splice(db.friendships.indexOf(f), 1);
    return true;
  },

  // Ranked
  create_ranked_challenge: ({ p_opponent, p_discipline, p_variant, p_message }, viewer) => {
    if (p_opponent === viewer) fail('22023', 'invalid opponent');
    if (!profileOf(p_opponent) || !canViewAuthor(viewer, p_opponent)) fail('P0002', 'user not found');
    const pair = (r: Row) => pairKey(r.challenger_id, r.opponent_id).join() === pairKey(viewer, p_opponent).join();
    if (db.ranked_matches.some((r) => pair(r) && r.discipline === p_discipline && OPEN.includes(r.status))) fail('23505', 'already open');
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    if (db.ranked_matches.filter((r) => pair(r) && [...OPEN, 'confirmed'].includes(r.status) && r.created_at > weekAgo).length >= 3) {
      fail('P0429', 'weekly ranked limit with this opponent reached', 'pair_limit');
    }
    const row = {
      id: uuid(),
      discipline: p_discipline,
      variant: p_variant,
      challenger_id: viewer,
      opponent_id: p_opponent,
      message: p_message,
      status: 'pending',
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
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      created_at: now(),
      settled_at: null,
    };
    db.ranked_matches.push(row);
    emit('ranked_matches', 'INSERT', row);
    return row.id;
  },
  respond_ranked_challenge: ({ p_id, p_accept }, viewer) => {
    const r = rankedById(p_id);
    if (r.opponent_id !== viewer) fail('P0002', 'ranked match not found');
    if (r.status !== 'pending') fail('22023', `challenge is ${r.status}`);
    Object.assign(r, { status: p_accept ? 'accepted' : 'declined', responded_at: now() });
    emit('ranked_matches', 'UPDATE', r);
    return r.status;
  },
  cancel_ranked_challenge: ({ p_id }, viewer) => {
    const r = rankedById(p_id);
    if (![r.challenger_id, r.opponent_id].includes(viewer)) fail('P0002', 'ranked match not found');
    if (!['pending', 'accepted'].includes(r.status) || r.match_id) fail('22023', 'only unrecorded challenges can be cancelled');
    r.status = 'cancelled';
    emit('ranked_matches', 'UPDATE', r);
    return null;
  },
  link_ranked_match: ({ p_id, p_match_id }, viewer) => {
    const r = rankedById(p_id);
    if (![r.challenger_id, r.opponent_id].includes(viewer)) fail('P0002', 'ranked match not found');
    if (r.status !== 'accepted' || r.match_id) fail('22023', 'ranked match is not waiting for a recording');
    const match = db.matches.find((m) => m.id === p_match_id && m.owner_id === viewer) ?? fail('P0002', 'match not found');
    if (match.status !== 'draft') fail('22023', 'only a new recording can be ranked');
    if (match.discipline !== r.discipline || match.variant !== r.variant) fail('22023', 'recording does not match the ranked ruleset');
    Object.assign(r, { match_id: p_match_id, fighter_a_id: viewer, fighter_b_id: viewer === r.challenger_id ? r.opponent_id : r.challenger_id });
    emit('ranked_matches', 'UPDATE', r);
    return null;
  },
  dispute_ranked_result: ({ p_id, p_reason }, viewer) => {
    const r = rankedById(p_id);
    if (![r.challenger_id, r.opponent_id].includes(viewer)) fail('P0002', 'ranked match not found');
    if (r.status !== 'awaiting_confirmation') fail('22023', 'result is not awaiting confirmation');
    if (!String(p_reason ?? '').trim()) fail('22023', 'a reason is required');
    Object.assign(r, { status: 'disputed', dispute_reason: String(p_reason).slice(0, 280), disputed_by: viewer });
    emit('ranked_matches', 'UPDATE', r);
    return null;
  },
  feature_title: ({ p_title_id }, viewer) => {
    const mine = db.user_titles.filter((title) => title.user_id === viewer);
    if (p_title_id && !mine.some((title) => title.title_id === p_title_id)) fail('P0002', 'title not unlocked');
    for (const title of mine) title.is_featured = title.title_id === p_title_id;
    return null;
  },
  get_leaderboard: ({ p_discipline, p_scope = 'global', p_limit = 50 }, viewer) =>
    db.ranked_ratings
      .filter((r) => r.discipline === p_discipline && canViewAuthor(viewer, r.user_id) && (r.games >= 5 || r.user_id === viewer))
      .filter((r) => p_scope === 'global' || r.user_id === viewer || areFriends(viewer, r.user_id))
      .sort((a, b) => b.rating - a.rating || b.games - a.games)
      .slice(0, p_limit)
      .map((r, index) => ({
        ladder_position: index + 1,
        ...personRow(r.user_id),
        rating: r.rating,
        games: r.games,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        featured_title: db.user_titles.find((title) => title.user_id === r.user_id && title.is_featured)?.title_id ?? null,
      })),
  get_ranked_opponents: ({ p_discipline, p_limit = 20 }, viewer) => {
    const mine = db.ranked_ratings.find((r) => r.user_id === viewer && r.discipline === p_discipline)?.rating ?? 1000;
    const busy = new Set(
      db.ranked_matches.filter((r) => r.discipline === p_discipline && OPEN.includes(r.status) && [r.challenger_id, r.opponent_id].includes(viewer)).flatMap((r) => [r.challenger_id, r.opponent_id]),
    );
    const pool = db.profiles
      .filter((p) => p.id !== viewer && !busy.has(p.id) && !blocked(viewer, p.id))
      .map((p) => ({ p, rating: db.ranked_ratings.find((r) => r.user_id === p.id && r.discipline === p_discipline) }))
      .filter(({ p, rating }) => (rating ? canViewAuthor(viewer, p.id) : areFriends(viewer, p.id)));
    return pool
      .map(({ p, rating }) => ({
        ...personRow(p.id),
        rating: rating?.rating ?? 1000,
        games: rating?.games ?? 0,
        is_friend: areFriends(viewer, p.id),
        rating_gap: (rating?.rating ?? 1000) - mine,
      }))
      .sort((a, b) => Math.abs(a.rating_gap) - Math.abs(b.rating_gap) || b.games - a.games)
      .slice(0, p_limit);
  },

  // Owner Panel
  admin_search_users: ({ p_query = '', p_limit = 25, p_offset = 0 }) => {
    requireOwner();
    const q = String(p_query).toLowerCase();
    return db.profiles
      .filter((p) => !q || p.username.toLowerCase().includes(q) || p.display_name.toLowerCase().includes(q) || db.users.find((u) => u.id === p.id)?.email.includes(q))
      .slice(p_offset, p_offset + p_limit)
      .map((p) => adminRow(p.id));
  },
  admin_set_unlimited: ({ p_user_id, p_value, p_reason }) => {
    requireOwner();
    const e = entitlementsOf(p_user_id);
    audit('set_unlimited', p_user_id, { is_unlimited: e.is_unlimited }, { is_unlimited: p_value }, p_reason);
    e.is_unlimited = p_value;
    return e;
  },
  admin_update_entitlements: ({ p_user_id, p_monthly_analysis_limit, p_max_video_seconds, p_is_suspended, p_suspended_reason, p_reason }) => {
    requireOwner();
    const e = entitlementsOf(p_user_id);
    const before = { ...e };
    if (p_monthly_analysis_limit !== null) e.monthly_analysis_limit = p_monthly_analysis_limit;
    if (p_max_video_seconds !== null) e.max_video_seconds = p_max_video_seconds;
    if (p_is_suspended !== null) e.is_suspended = p_is_suspended;
    if (p_suspended_reason !== null) e.suspended_reason = p_suspended_reason;
    audit('update_entitlements', p_user_id, before, { ...e }, p_reason);
    return e;
  },
  admin_usage_overview: () => {
    requireOwner();
    const rows = db.profiles.map((p) => adminRow(p.id));
    const usage = usageFor(me()!);
    return {
      period_start: usage.period_start,
      total_users: rows.length,
      unlimited_users: rows.filter((r) => r.is_unlimited).length,
      suspended_users: rows.filter((r) => r.is_suspended).length,
      analyses_this_month: rows.reduce((sum, r) => sum + r.used_this_month, 0),
      platform_units_this_month: rows.reduce((sum, r) => sum + r.used_this_month, 0),
      byok_analyses_this_month: 0,
      active_users_this_month: rows.filter((r) => r.used_this_month > 0).length,
      top_users: rows
        .sort((a, b) => b.used_this_month - a.used_this_month)
        .slice(0, 5)
        .map((r) => ({ user_id: r.user_id, username: r.username, units: r.used_this_month, analyses: r.used_this_month })),
    };
  },
  admin_audit_log: ({ p_limit = 50 }) => {
    requireOwner();
    return db.audit_log.slice(0, p_limit).map((entry) => ({
      ...entry,
      actor_username: profileOf(entry.actor_id)?.username ?? null,
      target_username: entry.target_user_id ? (profileOf(entry.target_user_id)?.username ?? null) : null,
    }));
  },
  admin_list_ranked_disputes: () => {
    requireOwner();
    return db.ranked_matches
      .filter((r) => r.status === 'disputed')
      .map((r) => ({ ...r, fighter_a_username: profileOf(r.fighter_a_id)?.username ?? null, fighter_b_username: profileOf(r.fighter_b_id)?.username ?? null, updated_at: now() }));
  },
  admin_resolve_ranked_dispute: ({ p_id, p_outcome, p_reason }) => {
    requireOwner();
    const r = rankedById(p_id);
    if (r.status !== 'disputed') fail('22023', 'ranked match is not disputed');
    if (p_outcome === 'void') Object.assign(r, { status: 'voided', settled_at: now() });
    else Object.assign(r, { status: 'awaiting_confirmation', confirmed_a_at: now(), confirmed_b_at: now() });
    audit('resolve_ranked_dispute', r.disputed_by, { status: 'disputed' }, { outcome: p_outcome, status: r.status }, p_reason ?? null);
    emit('ranked_matches', 'UPDATE', r);
    return r.status;
  },
  admin_ban_user: ({ p_user_id, p_reason }) => {
    requireOwner();
    if (!String(p_reason ?? '').trim()) fail('22023', 'a reason is required');
    banUser(p_user_id, String(p_reason).trim(), 'other', 'owner');
    return null;
  },
  admin_unban_user: ({ p_user_id }) => {
    requireOwner();
    const ban = db.bans.find((row) => row.user_id === p_user_id) ?? fail('P0002', 'not banned');
    db.bans = db.bans.filter((row) => row.user_id !== p_user_id);
    db.moderation_strikes = db.moderation_strikes.filter((row) => row.user_id !== p_user_id);
    const e = entitlementsOf(p_user_id);
    if (e.suspended_reason === `Banned: ${ban.reason}`) Object.assign(e, { is_suspended: ban.prior_suspended, suspended_reason: ban.prior_suspended_reason });
    audit('unban', p_user_id, { category: ban.category, source: ban.source }, {}, 'Ban lifted');
    return null;
  },
  admin_list_bans: () => {
    requireOwner();
    return db.bans.map((ban) => ({
      ...ban,
      username: profileOf(ban.user_id)?.username ?? null,
      strikes: db.moderation_strikes.filter((s) => s.user_id === ban.user_id).length,
    }));
  },
  admin_list_strikes: () => {
    requireOwner();
    return db.moderation_strikes.slice(0, 100).map((strike) => ({ ...strike, username: profileOf(strike.user_id)?.username ?? null }));
  },
  admin_list_blocked_terms: () => {
    requireOwner();
    return [...db.blocked_terms].sort((a, b) => a.category.localeCompare(b.category) || a.term.localeCompare(b.term));
  },
  admin_add_blocked_term: ({ p_term, p_category }) => {
    requireOwner();
    const term = String(p_term ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]+( [a-z0-9]+)*\*?$/.test(term) || term.length < 2 || term.length > 60) fail('23514', 'invalid term');
    db.blocked_terms = db.blocked_terms.filter((row) => row.term !== term);
    db.blocked_terms.push({ term, category: p_category, created_at: now() });
    audit('add_blocked_term', null, {}, { term, category: p_category }, null);
    return null;
  },
  admin_remove_blocked_term: ({ p_term }) => {
    requireOwner();
    db.blocked_terms = db.blocked_terms.filter((row) => row.term !== p_term);
    audit('remove_blocked_term', null, { term: p_term }, {}, null);
    return null;
  },
  admin_remove_post: ({ p_post_id, p_reason }) => {
    requireOwner();
    if (!String(p_reason ?? '').trim()) fail('22023', 'a reason is required');
    const post = db.posts.find((row) => row.id === p_post_id);
    if (!post) fail('P0002', 'post not found');
    db.posts = db.posts.filter((row) => row.id !== p_post_id);
    audit('remove_post', post!.author_id as string, { post_id: p_post_id }, {}, p_reason as string);
    return null;
  },
};

// Edge Functions -------------------------------------------------------------------------

function functionError(status: number, code: string) {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: { code, message: code } }), { status }));
}

const FUNCTIONS: Record<string, (body: Row, method: string, viewer: string) => unknown> = {
  // The preview has no AI: every picture passes the check.
  moderation: (body, _method, viewer) => {
    if (body.action !== 'avatar') fail('validation_failed', 'Unknown action');
    const avatars = db.storage.avatars!;
    if (!avatars.delete(`${viewer}/pending.jpg`)) fail('not_found', 'Upload the picture first');
    const path = `${viewer}/${uuid()}.jpg`;
    avatars.add(path);
    const profile = profileOf(viewer)!;
    if (profile.avatar_path) avatars.delete(profile.avatar_path);
    profile.avatar_path = path;
    return { status: 'ok', path };
  },
  'analyze-match': (body, _method, viewer) => {
    const action = body.action ?? 'analyze';
    switch (action) {
      case 'analyze':
        return startAnalysis(body.matchId, body.keySource ?? 'platform');
      case 'live_start': {
        const match = db.matches.find((m) => m.id === body.matchId && m.owner_id === viewer) ?? fail('not_found', 'Not found');
        setMatch(match, { status: 'live' });
        const usage = usageFor(viewer);
        return { status: 'live', usage: { used: usage.used, monthlyLimit: usage.monthly_limit, isUnlimited: usage.is_unlimited } };
      }
      case 'live_batch':
        return { status: 'processing' };
      case 'live_finalize':
        return startAnalysis(body.matchId, 'platform');
      case 'live_cancel': {
        const match = db.matches.find((m) => m.id === body.matchId && m.owner_id === viewer);
        if (match?.status === 'live') setMatch(match, { status: 'draft' });
        return { status: 'cancelled' };
      }
      default:
        return fail('validation_failed', 'unknown action');
    }
  },
  ranked: (body, _method, viewer) => {
    const r = rankedById(body.id);
    const participant = [r.fighter_a_id, r.fighter_b_id].includes(viewer);
    if (body.action === 'confirm') {
      if (!participant) fail('not_found', 'Not found');
      if (r.status !== 'awaiting_confirmation') fail('invalid_state', 'not awaiting confirmation');
      if (viewer === r.fighter_a_id) r.confirmed_a_at ??= now();
      else r.confirmed_b_at ??= now();
      emit('ranked_matches', 'UPDATE', r);
      return rankedReady(r) ? settle(r) : { id: r.id, status: 'awaiting_confirmation' };
    }
    if (!participant && !isOwner(viewer)) fail('not_found', 'Not found');
    return settle(r);
  },
  'api-keys': (body, method, viewer) => {
    if (method === 'GET') return { keys: db.api_keys.filter((key) => key.user_id === viewer).map(({ user_id: _u, ...key }) => key) };
    if (method === 'DELETE') {
      db.api_keys = db.api_keys.filter((key) => key.user_id !== viewer);
      return { deleted: true };
    }
    const apiKey = String(body.apiKey ?? '');
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(apiKey)) fail('invalid_key_format', 'invalid key');
    db.api_keys = db.api_keys.filter((key) => key.user_id !== viewer);
    db.api_keys.push({ user_id: viewer, provider: 'anthropic', last4: apiKey.slice(-4), label: body.label ?? null, created_at: now(), last_used_at: null });
    return { stored: true };
  },
  account: (body, method, viewer) => {
    if (method === 'POST') {
      const birth = { year: Number(body.birthYear), month: Number(body.birthMonth) };
      if (meetsMinimumAge(birth)) {
        ageChecked.add(viewer);
        return { status: 'ok' };
      }
      db.users = db.users.filter((user) => user.id !== viewer);
      session = null;
      for (const listener of authListeners) listener('SIGNED_OUT', null);
      return { status: 'not_eligible' };
    }
    if (method === 'GET') {
      return { exportedAt: now(), profile: profileOf(viewer), matches: db.matches.filter((m) => m.owner_id === viewer), note: 'Preview export (sample data).' };
    }
    session = null;
    for (const listener of authListeners) listener('SIGNED_OUT', null);
    return { deleted: true };
  },
};

// Auth -----------------------------------------------------------------------------------

function issueSession(userId: string, aal: 'aal1' | 'aal2'): PreviewSession {
  const user = db.users.find((u) => u.id === userId)!;
  return {
    access_token: `preview-token-${userId}-${++tokenSeq}`,
    refresh_token: `preview-refresh-${tokenSeq}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    aal,
    user: { id: userId, email: user.email, created_at: user.created_at, factors: db.mfa_factors.filter((f) => f.user_id === userId) },
  };
}

function setSession(next: PreviewSession | null, event: string) {
  session = next;
  for (const listener of authListeners) listener(event, next);
}

const verifiedFactors = (uid: string) => db.mfa_factors.filter((factor) => factor.user_id === uid && factor.status === 'verified');

const auth = {
  getSession: async () => ({ data: { session }, error: null }),
  getUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
  onAuthStateChange(callback: (event: string, session: PreviewSession | null) => void) {
    authListeners.add(callback);
    setTimeout(() => callback('INITIAL_SESSION', session), 0);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    await latency(250);
    const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || password !== PREVIEW_PASSWORD) return { data: { session: null, user: null }, error: { status: 400, message: 'Invalid login credentials' } };
    if (isBanned(user.id)) return { data: { session: null, user: null }, error: { status: 400, code: 'user_banned', message: 'User is banned' } };
    user.last_sign_in_at = now();
    setSession(issueSession(user.id, 'aal1'), 'SIGNED_IN');
    return { data: { session, user: session!.user }, error: null };
  },
  async signUp({ email, options }: { email: string; password: string; options?: { data?: Row } }) {
    await latency(250);
    if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return { data: { user: null, session: null }, error: null };
    const uid = uuid();
    db.users.push({ id: uid, email, created_at: now(), last_sign_in_at: null });
    db.profiles.push({ id: uid, username: options?.data?.username ?? `user_${uuidSeq}`, display_name: options?.data?.display_name ?? 'New athlete', bio: '', avatar_path: null, primary_discipline: null, visibility: 'private', created_at: now() });
    db.user_entitlements.push({ user_id: uid, role: 'user', is_unlimited: false, monthly_analysis_limit: 10, max_video_seconds: 600, is_suspended: false });
    // Email confirmation is on: no session until the link is opened.
    return { data: { user: { id: uid, email }, session: null }, error: null };
  },
  async signOut() {
    setSession(null, 'SIGNED_OUT');
    return { error: null };
  },
  async refreshSession() {
    if (session) setSession(issueSession(session.user.id, session.aal), 'TOKEN_REFRESHED');
    return { data: { session }, error: null };
  },
  async exchangeCodeForSession() {
    return { data: { session: null }, error: { message: 'Email links are not available in the preview' } };
  },
  async signInWithOAuth() {
    return { data: { provider: 'google', url: null }, error: { message: 'Google sign-in is not available in the preview' } };
  },
  mfa: {
    async listFactors() {
      await latency();
      const all = session ? db.mfa_factors.filter((f) => f.user_id === session!.user.id) : [];
      return { data: { all, totp: all.filter((f) => f.status === 'verified') }, error: null };
    },
    async enroll({ friendlyName }: { friendlyName?: string }) {
      await latency(150);
      const factor = { id: uuid(), user_id: session!.user.id, friendly_name: friendlyName, factor_type: 'totp', status: 'unverified', created_at: now(), updated_at: now() };
      db.mfa_factors.push(factor);
      const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      return { data: { id: factor.id, type: 'totp', totp: { secret, uri: `otpauth://totp/MatIQ:${session!.user.email}?secret=${secret}&issuer=MatIQ`, qr_code: '' } }, error: null };
    },
    async challengeAndVerify({ factorId, code }: { factorId: string; code: string }) {
      await latency(200);
      const factor = db.mfa_factors.find((f) => f.id === factorId);
      // Any 6-digit code works in the preview, except 000000 (to show the error path).
      if (!factor || !/^\d{6}$/.test(code) || code === '000000') return { data: null, error: { message: 'Invalid TOTP code entered' } };
      factor.status = 'verified';
      setSession(issueSession(session!.user.id, 'aal2'), 'MFA_CHALLENGE_VERIFIED');
      return { data: { access_token: session!.access_token }, error: null };
    },
    async unenroll({ factorId }: { factorId: string }) {
      db.mfa_factors = db.mfa_factors.filter((f) => f.id !== factorId);
      return { data: { id: factorId }, error: null };
    },
    async getAuthenticatorAssuranceLevel() {
      if (!session) return { data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] }, error: null };
      const next = verifiedFactors(session.user.id).length > 0 ? 'aal2' : 'aal1';
      return { data: { currentLevel: session.aal, nextLevel: next, currentAuthenticationMethods: [] }, error: null };
    },
  },
};

// Storage --------------------------------------------------------------------------------

const AVATAR_COLORS = ['#3B82F6', '#EF4444', '#F97316', '#22C55E', '#8B5CF6', '#EAB308', '#14B8A6', '#EC4899'];

function avatarDataUri(path: string): string {
  const uid = path.split('/')[0] ?? '';
  const person = profileOf(uid);
  const initials = (person?.display_name ?? '?')
    .split(/\s+/)
    .map((part: string) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const color = AVATAR_COLORS[[...uid].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${color}"/><text x="64" y="80" font-family="Helvetica, Arial, sans-serif" font-size="48" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  // base64: react-native-web re-encodes `;utf8,` SVG URIs itself.
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function bucket(name: string) {
  const objects = db.storage[name] ?? (db.storage[name] = new Set());
  return {
    async list(folder: string) {
      await latency();
      const prefix = `${folder}/`;
      return { data: [...objects].filter((path) => path.startsWith(prefix)).map((path) => ({ name: path.slice(prefix.length) })), error: null };
    },
    async upload(path: string) {
      await latency(30);
      if (isBanned(me())) return { data: null, error: { message: 'banned' } };
      if (ageCheckPending()) return { data: null, error: { message: 'age_check_required' } };
      if (name === 'avatars' && path !== `${me()}/pending.jpg`) return { data: null, error: { message: 'new row violates row-level security policy' } };
      objects.add(path);
      return { data: { path }, error: null };
    },
    async remove(paths: string[]) {
      for (const path of paths) objects.delete(path);
      return { data: paths.map((path) => ({ name: path })), error: null };
    },
    async createSignedUrl(path: string) {
      await latency(30);
      if (name === 'avatars') return { data: { signedUrl: avatarDataUri(path) }, error: null };
      return objects.has(path) ? { data: { signedUrl: `preview://${name}/${path}` }, error: null } : { data: null, error: { message: 'Object not found' } };
    },
    async createSignedUploadUrl(path: string) {
      if (ageCheckPending()) return { data: null, error: { message: 'age_check_required' } };
      objects.add(path);
      return { data: { signedUrl: `preview://upload/${name}/${path}`, path, token: 'preview' }, error: null };
    },
  };
}

// Client ---------------------------------------------------------------------------------

const client = {
  auth,
  from: (table: string) => new QueryBuilder(table as TableName),
  async rpc(name: string, args: Row = {}, options: { get?: boolean } = {}) {
    await latency();
    const handler = RPCS[name];
    if (!handler) return { data: null, error: { code: 'PGRST202', message: `function ${name} not found`, details: null, hint: null } };
    if (!me()) return { data: null, error: { code: '42501', message: 'permission denied', details: null, hint: null } };
    if (isBanned(me())) return { data: null, error: BANNED };
    if (!options.get && ageCheckPending()) return { data: null, error: AGE_CHECK_REQUIRED };
    try {
      return { data: structuredClone(handler(args, me()!)), error: null };
    } catch (error) {
      return { data: null, error: toPostgrestError(error) };
    }
  },
  functions: {
    async invoke(name: string, options: { body?: Row; method?: string } = {}) {
      await latency(250);
      const [fn, query] = name.split('?');
      const handler = FUNCTIONS[fn ?? ''];
      if (!handler) return { data: null, error: functionError(404, 'not_found') };
      if (!me()) return { data: null, error: functionError(401, 'unauthorized') };
      if (isBanned(me())) return { data: null, error: functionError(403, 'banned') };
      if (fn !== 'account' && ageCheckPending()) return { data: null, error: functionError(403, 'age_check_required') };
      void query;
      try {
        return { data: structuredClone(handler(options.body ?? {}, options.method ?? 'POST', me()!)), error: null };
      } catch (error) {
        return { data: null, error: functionError(error instanceof PreviewError && error.code === 'not_found' ? 404 : 409, error instanceof PreviewError ? error.code : 'internal_error') };
      }
    },
  },
  storage: { from: bucket },
  channel: (name: string) => new PreviewChannel(name),
  removeChannel: (channel: PreviewChannel) => channel.unsubscribe(),
};

export const supabase = client as unknown as SupabaseClient;

export function initSupabase(): SupabaseClient {
  return supabase;
}

/** For the walkthrough: the current legal versions, so tests can reason about the consent gate. */
export const PREVIEW_INFO = { demoEmail: DEMO_EMAIL, password: PREVIEW_PASSWORD, legalVersions: LEGAL_VERSIONS };
