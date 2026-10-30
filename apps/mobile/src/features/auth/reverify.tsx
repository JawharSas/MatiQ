'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

/**
 * Confirming it's you before a sensitive change: the password, Google,
 * two-factor.
 *
 * When the last sign-in was a while ago, Clerk refuses such a change with
 * "reverification required" and its `useReverification` hook calls
 * `onNeedsReverification`. Here that opens a small prompt: the account's
 * password (or a code by email when it has none), then the authenticator or
 * a backup code when Clerk wants both factors. The change is then retried.
 */

import { useReverification, useSession } from '@clerk/expo';
import { type ReactNode, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, View } from 'react-native';
import { Body, Button, Card, ErrorText, Heading, TextField } from '@/ui/components';
import { colors, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { clerkErrorCode, clerkErrorMessage } from './clerk-errors';

type Level = 'first_factor' | 'second_factor' | 'multi_factor';

interface Request {
  level: Level | undefined;
  complete(): void;
  cancel(): void;
}

/** True when the person closed the prompt: nothing went wrong. */
export function isVerificationCancelled(error: unknown): boolean {
  return clerkErrorCode(error) === 'reverification_cancelled';
}

/**
 * `action`, asking the person to confirm it's them first when Clerk wants
 * that. Render `prompt` in the screen.
 */
export function useVerifiedAction<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
): { run: (...args: Args) => Promise<Result>; prompt: ReactNode } {
  const [request, setRequest] = useState<Request | null>(null);
  const run = useReverification(action, { onNeedsReverification: (needs) => setRequest(needs) });
  const prompt = request ? (
    <ReverifyPrompt
      level={request.level}
      onDone={() => {
        request.complete();
        setRequest(null);
      }}
      onCancel={() => {
        request.cancel();
        setRequest(null);
      }}
    />
  ) : null;
  return { run: run as (...args: Args) => Promise<Result>, prompt };
}

type Step =
  | { kind: 'starting' }
  | { kind: 'password' }
  | { kind: 'email-code'; emailAddressId: string; email: string }
  | { kind: 'second-factor'; backup: boolean };

function ReverifyPrompt({ level, onDone, onCancel }: { level: Level | undefined; onDone: () => void; onCancel: () => void }) {
  useTheme();
  const { session } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Where the verification stands now: the next factor to ask for, or done.
  const next = async (verification: Awaited<ReturnType<NonNullable<typeof session>['startVerification']>>) => {
    setValue('');
    if (verification.status === 'complete') return onDone();
    if (verification.status === 'needs_second_factor') return setStep({ kind: 'second-factor', backup: false });
    const factors = verification.supportedFirstFactors ?? [];
    if (factors.some((factor) => factor.strategy === 'password')) return setStep({ kind: 'password' });
    const emailCode = factors.find((factor) => factor.strategy === 'email_code');
    if (emailCode && 'emailAddressId' in emailCode && session) {
      await session.prepareFirstFactorVerification({ strategy: 'email_code', emailAddressId: emailCode.emailAddressId });
      return setStep({ kind: 'email-code', emailAddressId: emailCode.emailAddressId, email: emailCode.safeIdentifier ?? '' });
    }
    setError("This account can't be confirmed here. Sign out and back in, then try again.");
  };

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    session
      .startVerification({ level: level ?? 'first_factor' })
      .then(async (verification) => {
        if (!cancelled) await next(verification);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(clerkErrorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
    // Started once per prompt.
  }, [session]);

  const submit = async () => {
    if (!session || !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const code = value.replace(/\s/g, '');
      const verification =
        step.kind === 'password'
          ? await session.attemptFirstFactorVerification({ strategy: 'password', password: value })
          : step.kind === 'email-code'
            ? await session.attemptFirstFactorVerification({ strategy: 'email_code', code })
            : step.kind === 'second-factor' && step.backup
              ? await session.attemptSecondFactorVerification({ strategy: 'backup_code', code })
              : await session.attemptSecondFactorVerification({ strategy: 'totp', code });
      await next(verification);
    } catch (caught) {
      setError(clerkErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const field =
    step.kind === 'password' ? (
      <TextField label="Password" value={value} onChangeText={setValue} secureTextEntry autoComplete="current-password" textContentType="password" />
    ) : step.kind === 'starting' ? null : (
      <TextField
        label={step.kind === 'second-factor' && step.backup ? 'Backup code' : 'Code'}
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        keyboardType={step.kind === 'second-factor' && step.backup ? 'default' : 'number-pad'}
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
      />
    );
  const explanation =
    step.kind === 'password'
      ? 'For your security, enter your password to make this change.'
      : step.kind === 'email-code'
        ? `For your security, enter the code we sent to ${step.email || 'your email'}.`
        : step.kind === 'second-factor'
          ? step.backup
            ? 'Enter one of your backup codes.'
            : 'Enter the 6-digit code from your authenticator app.'
          : 'One moment…';

  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Card>
            <Heading>Confirm it's you</Heading>
            <Body muted>{explanation}</Body>
            {field}
            <ErrorText>{error}</ErrorText>
            {step.kind !== 'starting' ? <Button label="Confirm" onPress={() => void submit()} loading={busy} /> : null}
            {step.kind === 'second-factor' ? (
              <Button
                label={step.backup ? 'Use the authenticator app' : 'Use a backup code'}
                variant="ghost"
                onPress={() => {
                  setStep({ kind: 'second-factor', backup: !step.backup });
                  setValue('');
                  setError(null);
                }}
              />
            ) : null}
            <Button label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
          </Card>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: '100%', maxWidth: 440, alignSelf: 'center', borderRadius: 16, backgroundColor: colors.background },
}));
