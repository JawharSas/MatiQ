import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, Checkbox, ErrorText, LinkText, Loading, Screen, Title } from '@/ui/components';
import { ageCheckLocked, lockAgeCheck, submitBirthMonth } from './age';
import { type BirthInput, parseBirthMonth } from './age-rule';
import { BirthMonthField } from './BirthMonthField';
import { acceptCurrentVersions } from './consent';
import { LEGAL_DOCUMENTS, type LegalDocumentId } from './documents';

const NAMES: Record<LegalDocumentId, string> = { terms: 'Terms of Service', privacy: 'Privacy Policy' };

/**
 * Shown before the app whenever the person has not answered the age check or
 * not accepted the current Terms / Privacy Policy. The agreement box starts
 * unticked and Cancel signs out without saving anything.
 */
export function ConsentGate({ missing, needsAge }: { missing: LegalDocumentId[]; needsAge: boolean }) {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [birth, setBirth] = useState<BirthInput>({ month: null, year: '' });
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<boolean | null>(needsAge ? null : false);

  useEffect(() => {
    if (needsAge) void ageCheckLocked().then(setLocked);
  }, [needsAge]);

  if (locked === null) return <Loading />;

  if (needsAge && locked) {
    return (
      <Screen>
        <Title>We can't continue</Title>
        <Body>Sorry, MatIQ can't be used with this account on this device right now.</Body>
        <Button label="Sign out" onPress={() => void signOut()} />
      </Screen>
    );
  }

  const documents = missing.map((id) => NAMES[id]).join(' and ');

  const submit = async () => {
    setError(null);
    const parsed = needsAge ? parseBirthMonth(birth) : null;
    if (parsed && !parsed.ok) return setError(parsed.error);
    if (missing.length > 0 && !agreed) return setError(`Tick the box to agree to the ${documents}.`);

    setBusy(true);
    try {
      if (parsed?.ok) {
        const result = await submitBirthMonth(parsed.value);
        if (result === 'not_eligible') {
          // The server has already deleted the account and everything in it.
          await lockAgeCheck();
          await signOut();
          return;
        }
      }
      if (missing.length > 0) await acceptCurrentVersions(missing);
      await queryClient.invalidateQueries({ queryKey: ['consent'] });
      await queryClient.invalidateQueries({ queryKey: ['age-check'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Before you continue</Title>
      {needsAge ? (
        <Card>
          <BirthMonthField value={birth} onChange={setBirth} />
        </Card>
      ) : null}
      {missing.length > 0 ? (
        <Card>
          <Body>{missing.length > 1 ? 'Please review our Terms and Privacy Policy.' : `Please review our updated ${documents}.`}</Body>
          {missing.map((id) => (
            <View key={id} style={{ gap: 6 }}>
              <Caption>{LEGAL_DOCUMENTS[id].summary}</Caption>
              <Link href={{ pathname: '/legal/[doc]', params: { doc: id } }}>
                <LinkText>
                  Read the {LEGAL_DOCUMENTS[id].title} (version {LEGAL_DOCUMENTS[id].version})
                </LinkText>
              </Link>
            </View>
          ))}
          <Checkbox
            label={`I agree to the ${documents}`}
            checked={agreed}
            onChange={(next) => {
              setAgreed(next);
              setError(null);
            }}
          />
        </Card>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button label="Continue" onPress={() => void submit()} loading={busy} />
      <Button label="Cancel" variant="secondary" hint="Signs you out without saving" disabled={busy} onPress={() => void signOut()} />
    </Screen>
  );
}

/** The birth month remembered from sign-up was under 13: the account is gone, so sign out. */
export function NotEligible() {
  const { signOut } = useAuth();
  useEffect(() => {
    void lockAgeCheck().then(() => signOut());
  }, [signOut]);
  return <Loading />;
}
