/**
 * Age check (COPPA) on the device: the server call, the birth month an email
 * sign-up gave before it had a session, and the short device lock after an
 * under-13 answer (so the age cannot simply be retried with another date).
 */

import { fromFunctionError } from '@/lib/errors';
import { openSecureStorage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { BirthMonth } from './age-rule';

const LOCK_KEY = 'age:locked-until';
const LOCK_MS = 24 * 60 * 60 * 1000;
const pendingKey = (email: string) => `age:pending:${email.toLowerCase()}`;

export type AgeResult = 'ok' | 'not_eligible';

/** Sends the birth month. 'not_eligible' means the server has already deleted the account. */
export async function submitBirthMonth(birth: BirthMonth): Promise<AgeResult> {
  const { data, error } = await supabase.functions.invoke<{ status: AgeResult }>('account', {
    method: 'POST',
    body: { birthYear: birth.year, birthMonth: birth.month },
  });
  if (error || !data) throw await fromFunctionError(error);
  return data.status;
}

export async function lockAgeCheck(): Promise<void> {
  (await openSecureStorage()).set(LOCK_KEY, String(Date.now() + LOCK_MS));
}

export async function ageCheckLocked(): Promise<boolean> {
  const until = Number((await openSecureStorage()).getString(LOCK_KEY) ?? 0);
  return Number.isFinite(until) && until > Date.now();
}

/** Email sign-ups have no session yet: keep the month until the first sign-in. */
export async function rememberBirthMonthForSignup(email: string, birth: BirthMonth): Promise<void> {
  (await openSecureStorage()).set(pendingKey(email), JSON.stringify(birth));
}

/**
 * 'done' when the check is on record, 'needed' when the person must answer it,
 * 'not_eligible' when the month remembered from sign-up was under 13 (the
 * account is then already deleted).
 */
export async function ageCheckStatus(email: string): Promise<'done' | 'needed' | 'not_eligible'> {
  // A GET request: the server refuses other requests until the age check is done.
  const { data, error } = await supabase.rpc('my_age_check', undefined, { get: true });
  if (error) throw new Error(error.message);
  if (data === true) return 'done';

  const storage = await openSecureStorage();
  const pending = email ? storage.getString(pendingKey(email)) : undefined;
  if (!pending) return 'needed';
  try {
    const birth = JSON.parse(pending) as BirthMonth;
    const result = await submitBirthMonth(birth);
    storage.remove(pendingKey(email));
    return result === 'ok' ? 'done' : 'not_eligible';
  } catch {
    // Asked again in the gate if the stored month cannot be sent.
    storage.remove(pendingKey(email));
    return 'needed';
  }
}
