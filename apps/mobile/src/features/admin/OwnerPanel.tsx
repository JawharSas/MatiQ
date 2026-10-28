import { useDeferredValue, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Segmented, TextField, ToggleRow } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';
import {
  type AdminUserRow,
  type RankedDispute,
  useAdminUsers,
  useAuditLog,
  useRankedDisputes,
  useResolveDispute,
  useSetUnlimited,
  useUpdateEntitlements,
  useUsageOverview,
} from './api';

type Tab = 'users' | 'overview' | 'disputes' | 'audit';

export function OwnerPanel() {
  const [tab, setTab] = useState<Tab>('users');
  return (
    <View style={styles.stack}>
      <Segmented
        options={[
          { value: 'users', label: 'Users' },
          { value: 'overview', label: 'Usage' },
          { value: 'disputes', label: 'Disputes' },
          { value: 'audit', label: 'Audit log' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'users' ? <UserSearch /> : tab === 'overview' ? <Overview /> : tab === 'disputes' ? <Disputes /> : <AuditLog />}
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
  const [limit, setLimit] = useState(String(user.monthly_analysis_limit));
  const [expanded, setExpanded] = useState(false);
  const error = setUnlimited.error ?? updateEntitlements.error;

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
            <Button label={user.is_suspended ? 'Restore account' : 'Suspend account'} variant="danger" onPress={toggleSuspended} />
          ) : null}
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
        @{dispute.fighter_a_username ?? 'deleted'} vs @{dispute.fighter_b_username ?? 'deleted'} · {dispute.discipline.toUpperCase()} ({dispute.variant})
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
