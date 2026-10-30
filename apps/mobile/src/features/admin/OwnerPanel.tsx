import { useDeferredValue, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { DISCIPLINE_LABELS } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ChoiceChips, ErrorText, Heading, Segmented, TextField, ToggleRow } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';
import {
  type AdminUserRow,
  type BlockedTerm,
  type RankedDispute,
  useAddBlockedTerm,
  useAdminUsers,
  useBans,
  useBanUser,
  useBlockedTerms,
  useRemoveBlockedTerm,
  useStrikes,
  useUnbanUser,
  useAuditLog,
  useRankedDisputes,
  useRemovePost,
  useResolveDispute,
  useSetUnlimited,
  useUpdateEntitlements,
  useUsageOverview,
} from './api';

type Tab = 'users' | 'overview' | 'disputes' | 'moderation' | 'content' | 'audit';

export function OwnerPanel() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <View style={styles.stack}>
      <Segmented
        options={[
          { value: 'users', label: 'Users' },
          { value: 'overview', label: 'Usage' },
          { value: 'disputes', label: 'Disputes' },
          { value: 'moderation', label: 'Moderation' },
          { value: 'content', label: 'Content' },
          { value: 'audit', label: 'Audit log' },
        ]}
        value={tab}
        onChange={setTab}
        columns={3}
      />
      {tab === 'users' ? (
        <UserSearch />
      ) : tab === 'overview' ? (
        <Overview />
      ) : tab === 'disputes' ? (
        <Disputes />
      ) : tab === 'moderation' ? (
        <Moderation />
      ) : tab === 'content' ? (
        <ContentTakedown />
      ) : (
        <AuditLog />
      )}
    </View>
  );
}

function UserSearch() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const users = useAdminUsers(deferredQuery, page);

  return (
    <View style={styles.stack}>
      <TextField
        label="Search by username, email or user id"
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPage(0);
        }}
        autoCapitalize="none"
        maxLength={100}
      />
      {users.error ? <ErrorText>{errorMessage(users.error)}</ErrorText> : null}
      {users.data?.map((user) => <UserRow key={user.user_id} user={user} />)}
      {users.data?.length === 0 ? <Caption>No users found.</Caption> : null}
      <View style={styles.pager}>
        <Button label="Previous" variant="secondary" disabled={page === 0} onPress={() => setPage((p) => Math.max(0, p - 1))} />
        <Button label="Next" variant="secondary" disabled={(users.data?.length ?? 0) < 25} onPress={() => setPage((p) => p + 1)} />
      </View>
    </View>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  const setUnlimited = useSetUnlimited();
  const updateEntitlements = useUpdateEntitlements();
  const ban = useBanUser();
  const [limit, setLimit] = useState(String(user.monthly_analysis_limit));
  const [banReason, setBanReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [banError, setBanError] = useState<string | null>(null);
  const error = setUnlimited.error ?? updateEntitlements.error ?? ban.error;

  const confirmBan = () => {
    if (!banReason.trim()) return setBanError('Enter a reason for the ban.');
    setBanError(null);
    Alert.alert(
      'Ban this account?',
      `${user.username} is signed out, hidden from everyone and blocked, with the networks they used, until you lift the ban under Moderation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Ban', style: 'destructive', onPress: () => ban.mutate({ userId: user.user_id, reason: banReason }) },
      ],
    );
  };

  const toggleUnlimited = (value: boolean) => {
    Alert.alert(
      value ? 'Grant unlimited access?' : 'Remove unlimited access?',
      `${user.username} will ${value ? 'bypass all monthly analysis caps' : 'return to their monthly limit'}. This is recorded in the audit log.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: value ? 'Grant' : 'Remove',
          style: value ? 'default' : 'destructive',
          onPress: () => setUnlimited.mutate({ userId: user.user_id, value, reason: 'Owner panel toggle' }),
        },
      ],
    );
  };

  const saveLimit = () => {
    const parsed = Number.parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) return;
    updateEntitlements.mutate({ userId: user.user_id, monthlyLimit: parsed, reason: 'Owner panel limit change' });
  };

  const toggleSuspended = () => {
    const suspend = !user.is_suspended;
    Alert.alert(suspend ? 'Suspend account?' : 'Restore account?', `This affects ${user.username} immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: suspend ? 'Suspend' : 'Restore',
        style: suspend ? 'destructive' : 'default',
        onPress: () =>
          updateEntitlements.mutate({
            userId: user.user_id,
            suspended: suspend,
            suspendedReason: suspend ? 'Suspended by owner' : '',
            reason: suspend ? 'Owner panel suspension' : 'Owner panel restore',
          }),
      },
    ]);
  };

  return (
    <Card>
      <View style={styles.rowHeader}>
        <View style={styles.fill}>
          <Text style={font.heading}>
            {user.display_name} <Text style={font.caption}>@{user.username}</Text>
          </Text>
          <Caption>{user.email ?? 'no email'}</Caption>
        </View>
        {user.role === 'owner' ? <Text style={styles.badge}>OWNER</Text> : null}
        {user.is_suspended ? <Text style={[styles.badge, { color: colors.danger }]}>SUSPENDED</Text> : null}
      </View>
      <Body muted>
        {user.used_this_month} / {user.is_unlimited ? '∞' : user.monthly_analysis_limit} this month · {user.total_analyses} total
      </Body>
      <ToggleRow
        label="Unlimited access"
        description="Bypasses every analysis cap (is_unlimited)."
        value={user.is_unlimited}
        onValueChange={toggleUnlimited}
        disabled={setUnlimited.isPending}
      />
      {expanded ? (
        <View style={styles.stack}>
          <TextField label="Monthly analysis limit" value={limit} onChangeText={setLimit} keyboardType="number-pad" maxLength={6} />
          <Button label="Save limit" variant="secondary" onPress={saveLimit} loading={updateEntitlements.isPending} />
          {user.role !== 'owner' ? (
            <>
              <Button label={user.is_suspended ? 'Restore account' : 'Suspend account'} variant="danger" onPress={toggleSuspended} />
              <TextField label="Ban reason" value={banReason} onChangeText={setBanReason} maxLength={280} error={banError} />
              <Button label="Ban account" variant="danger" icon="ban" loading={ban.isPending} onPress={confirmBan} />
            </>
          ) : null}
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setExpanded(false);
              setLimit(String(user.monthly_analysis_limit));
              setBanReason('');
              setBanError(null);
            }}
          />
        </View>
      ) : (
        <Button label="Manage" variant="secondary" onPress={() => setExpanded(true)} />
      )}
      {error ? <ErrorText>{errorMessage(error)}</ErrorText> : null}
    </Card>
  );
}

function Overview() {
  const overview = useUsageOverview();
  if (overview.error) return <ErrorText>{errorMessage(overview.error)}</ErrorText>;
  const data = overview.data;
  if (!data) return <Caption>Loading…</Caption>;
  const tiles: [string, number][] = [
    ['Users', data.total_users],
    ['Active this month', data.active_users_this_month],
    ['Analyses this month', data.analyses_this_month],
    ['Platform AI units', data.platform_units_this_month],
    ['BYOK analyses', data.byok_analyses_this_month],
    ['Unlimited users', data.unlimited_users],
    ['Suspended', data.suspended_users],
  ];
  return (
    <View style={styles.stack}>
      <View style={styles.tiles}>
        {tiles.map(([label, value]) => (
          <Card key={label} style={styles.tile}>
            <Text style={styles.tileValue}>{value}</Text>
            <Caption>{label}</Caption>
          </Card>
        ))}
      </View>
      <Card>
        <Heading>Top users this month</Heading>
        {data.top_users.length === 0 ? <Caption>No analyses yet.</Caption> : null}
        {data.top_users.map((user) => (
          <View key={user.user_id} style={styles.rowHeader}>
            <Text style={[font.body, styles.fill]}>@{user.username}</Text>
            <Text style={font.mono}>
              {user.units} units · {user.analyses} runs
            </Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

function Disputes() {
  const disputes = useRankedDisputes();
  if (disputes.error) return <ErrorText>{errorMessage(disputes.error)}</ErrorText>;
  return (
    <View style={styles.stack}>
      <Caption>
        Disputed ranked results. Watch the recording, then uphold the analysed result (ratings are applied) or void the match (no
        rating change). Both fighters see the outcome.
      </Caption>
      {disputes.data?.map((dispute) => <DisputeCard key={dispute.id} dispute={dispute} />)}
      {disputes.data?.length === 0 ? <Caption>No open disputes.</Caption> : null}
    </View>
  );
}

function DisputeCard({ dispute }: { dispute: RankedDispute }) {
  const router = useRouter();
  const resolve = useResolveDispute();
  const name = (uid: string | null, username: string | null) => (uid ? `@${username ?? 'deleted'}` : 'nobody');
  const winner =
    dispute.winner_id === null
      ? 'Draw'
      : `${name(dispute.winner_id, dispute.winner_id === dispute.fighter_a_id ? dispute.fighter_a_username : dispute.fighter_b_username)} by ${(dispute.result_method ?? 'decision').replace(/_/g, ' ')}`;
  const disputedBy = dispute.disputed_by === dispute.fighter_a_id ? dispute.fighter_a_username : dispute.fighter_b_username;

  const confirmResolve = (outcome: 'apply' | 'void') =>
    Alert.alert(outcome === 'apply' ? 'Uphold this result?' : 'Void this match?', outcome === 'apply' ? 'Ratings will be updated.' : 'No ratings change.', [
      { text: 'Cancel', style: 'cancel' },
      { text: outcome === 'apply' ? 'Uphold' : 'Void', style: 'destructive', onPress: () => resolve.mutate({ id: dispute.id, outcome }) },
    ]);

  return (
    <Card>
      <Text style={font.body}>
        @{dispute.fighter_a_username ?? 'deleted'} vs @{dispute.fighter_b_username ?? 'deleted'} · {DISCIPLINE_LABELS[dispute.discipline]} ({dispute.variant})
      </Text>
      <Caption>Analysed result: {winner}</Caption>
      <Caption>
        Disputed by @{disputedBy ?? 'deleted'}: {dispute.dispute_reason ?? 'no reason given'}
      </Caption>
      {dispute.match_id ? (
        <Button label="Watch recording" variant="secondary" onPress={() => router.push({ pathname: '/match/[id]', params: { id: dispute.match_id! } })} />
      ) : null}
      <View style={styles.pager}>
        <View style={styles.fill}>
          <Button label="Uphold result" disabled={resolve.isPending} onPress={() => confirmResolve('apply')} />
        </View>
        <View style={styles.fill}>
          <Button label="Void match" variant="danger" disabled={resolve.isPending} onPress={() => confirmResolve('void')} />
        </View>
      </View>
      <ErrorText>{resolve.error ? errorMessage(resolve.error) : null}</ErrorText>
    </Card>
  );
}

const TERM_CATEGORIES = [
  { value: 'sexual', label: 'Sexual' },
  { value: 'hate', label: 'Hate' },
  { value: 'harassment', label: 'Harassment' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  sexual_content: '18+ content',
  text: 'Word filter',
  other: 'Other',
};

/** Bans (with unban), the word filter and recent strikes. */
function Moderation() {
  const bans = useBans();
  const strikes = useStrikes();
  const unban = useUnbanUser();
  const [error, setError] = useState<string | null>(null);

  const confirmUnban = (userId: string, username: string | null) => {
    setError(null);
    Alert.alert('Lift this ban?', `@${username ?? 'deleted user'} can sign in again and their networks are unblocked.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lift ban', onPress: () => unban.mutate({ userId }, { onError: (caught) => setError(errorMessage(caught)) }) },
    ]);
  };

  return (
    <View style={styles.stack}>
      <Caption>
        Sexual content in a recording or profile picture bans an account at once, and three posts that break the word filter in 30
        days ban it too. A ban signs the person out and hides everything they posted. Networks only that person used are blocked
        for 30 days; shared ones (a gym's Wi-Fi, carrier and private addresses) never are. Only one-way fingerprints are kept.
      </Caption>
      <Heading>Bans</Heading>
      {bans.error ? <ErrorText>{errorMessage(bans.error)}</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      {bans.data?.map((ban) => (
        <Card key={ban.user_id}>
          <Text style={font.heading}>@{ban.username ?? 'deleted user'}</Text>
          <Body muted>{ban.reason}</Body>
          <Caption>
            {CATEGORY_LABELS[ban.category] ?? ban.category} · {ban.source === 'automatic' ? 'automatic' : 'by you'} ·{' '}
            {new Date(ban.created_at).toLocaleString()}
          </Caption>
          <Caption>
            {ban.networks_blocked === 1 ? '1 private network blocked' : `${ban.networks_blocked} private networks blocked`}
            {ban.networks_shared > 0 ? ` · ${ban.networks_shared} shared left open` : ''}
          </Caption>
          <Button label="Lift ban" variant="secondary" onPress={() => confirmUnban(ban.user_id, ban.username)} />
        </Card>
      ))}
      {bans.data?.length === 0 ? <Caption>Nobody is banned.</Caption> : null}

      <BlockedWords />

      <Heading>Recent strikes</Heading>
      {strikes.error ? <ErrorText>{errorMessage(strikes.error)}</ErrorText> : null}
      {strikes.data?.map((strike, index) => (
        <Card key={`${strike.user_id}-${strike.created_at}-${index}`}>
          <Text style={font.body}>
            @{strike.username ?? 'deleted user'} · {strike.kind.replace(/^post:/, 'post, ')}
          </Text>
          {strike.detail ? <Caption>“{strike.detail}”</Caption> : null}
          <Caption>{new Date(strike.created_at).toLocaleString()}</Caption>
        </Card>
      ))}
      {strikes.data?.length === 0 ? <Caption>No strikes in the last 90 days.</Caption> : null}
    </View>
  );
}

function BlockedWords() {
  const terms = useBlockedTerms();
  const add = useAddBlockedTerm();
  const remove = useRemoveBlockedTerm();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<BlockedTerm['category']>('harassment');
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const save = () => {
    const cleaned = term.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-z0-9]+( [a-z0-9]+)*\*?$/.test(cleaned) || cleaned.length < 2 || cleaned.length > 60) {
      return setError('Use 2 to 60 letters, numbers and spaces. End with * to also catch word endings.');
    }
    setError(null);
    add.mutate({ term: cleaned, category }, { onSuccess: () => setTerm(''), onError: (caught) => setError(errorMessage(caught)) });
  };

  return (
    <View style={styles.stack}>
      <Heading>Word filter</Heading>
      <Caption>
        Names, bios, match titles, dispute notes and posts are checked against this list, also when letters are spaced out,
        swapped for numbers or stretched. A post that matches is held back and counts as a strike.
      </Caption>
      <Card>
        <TextField label="Word or phrase to block" value={term} onChangeText={setTerm} autoCapitalize="none" maxLength={60} />
        <ChoiceChips label="Category" options={TERM_CATEGORIES} value={category} onChange={setCategory} columns={3} />
        <ErrorText>{error}</ErrorText>
        <Button label="Add to the filter" loading={add.isPending} onPress={save} />
      </Card>
      <Button
        label={showList ? 'Hide the list' : `Show the list${terms.data ? ` (${terms.data.length})` : ''}`}
        variant="secondary"
        onPress={() => setShowList((shown) => !shown)}
      />
      {terms.error ? <ErrorText>{errorMessage(terms.error)}</ErrorText> : null}
      {showList
        ? terms.data?.map((entry) => (
            <View key={entry.term} style={styles.rowHeader}>
              <Text style={[font.body, styles.fill]}>
                {entry.term} <Text style={font.caption}>· {entry.category}</Text>
              </Text>
              <Button
                label="Remove"
                variant="secondary"
                size="sm"
                hint={`Removes ${entry.term} from the filter`}
                onPress={() => remove.mutate({ term: entry.term }, { onError: (caught) => setError(errorMessage(caught)) })}
              />
            </View>
          ))
        : null}
    </View>
  );
}

const POST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Copyright (DMCA) takedowns and other removals, by post ID from a notice or report. */
function ContentTakedown() {
  const remove = useRemovePost();
  const [postId, setPostId] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirmRemove = () => {
    setDone(null);
    setError(null);
    if (!POST_ID.test(postId.trim())) return setError('Enter the post ID from the notice or report (for example 1b2c3d4e-...).');
    if (!reason.trim()) return setError('Enter a reason, such as "DMCA notice from Example Films, 29 Oct".');
    Alert.alert('Remove this post?', 'It is deleted for everyone and the removal is logged.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          remove.mutate(
            { postId, reason },
            {
              onSuccess: () => {
                setDone(`Post ${postId.trim()} was removed. Tell the person who posted it and send them the notice.`);
                setPostId('');
                setReason('');
              },
              onError: (caught) => setError(errorMessage(caught)),
            },
          ),
      },
    ]);
  };

  return (
    <View style={styles.stack}>
      <Caption>
        For copyright (DMCA) notices and other reports. Remove the post, tell the person who posted it and keep the notice. Suspend
        repeat infringers under Users.
      </Caption>
      <Card>
        <TextField label="Post ID" value={postId} onChangeText={setPostId} autoCapitalize="none" />
        <TextField label="Reason" value={reason} onChangeText={setReason} maxLength={280} />
        <ErrorText>{error}</ErrorText>
        {done ? <Body>{done}</Body> : null}
        <Button label="Remove post" variant="danger" icon="trash" loading={remove.isPending} onPress={confirmRemove} />
      </Card>
    </View>
  );
}

function AuditLog() {
  const log = useAuditLog();
  if (log.error) return <ErrorText>{errorMessage(log.error)}</ErrorText>;
  return (
    <View style={styles.stack}>
      {log.data?.map((entry) => (
        <Card key={entry.id}>
          <Text style={font.body}>
            @{entry.actor_username ?? 'unknown'} · {entry.action.replace(/_/g, ' ')} · @{entry.target_username ?? 'deleted user'}
          </Text>
          <Caption>
            {JSON.stringify(entry.old_value)} → {JSON.stringify(entry.new_value)}
          </Caption>
          <Caption>
            {new Date(entry.created_at).toLocaleString()}
            {entry.reason ? ` · ${entry.reason}` : ''}
          </Caption>
        </Card>
      ))}
      {log.data?.length === 0 ? <Caption>No owner actions recorded yet.</Caption> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  fill: { flex: 1 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { color: colors.accent, fontWeight: '800', fontSize: 11 },
  pager: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { minWidth: '45%', flexGrow: 1 },
  tileValue: { fontSize: 28, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
});
