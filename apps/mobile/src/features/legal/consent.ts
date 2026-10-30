/**
 * Records acceptance of the current Terms / Privacy Policy versions in
 * `legal_acceptances` (an immutable, per-version audit trail).
 *
 * With email confirmation enabled there is no session at sign-up time, so the
 * acceptance given on the sign-up form is remembered locally (encrypted
 * store) and written on the first sign-in, right after the age check (the
 * server accepts no writes before it).
 */

import { backend } from '@/lib/backend';
import { openSecureStorage } from '@/lib/storage';
import { LEGAL_VERSIONS, type LegalDocumentId } from './documents';

const pendingKey = (email: string) => `consent:pending:${email.toLowerCase()}`;

export async function rememberConsentForSignup(email: string): Promise<void> {
  (await openSecureStorage()).set(pendingKey(email), JSON.stringify(LEGAL_VERSIONS));
}

export async function acceptCurrentVersions(documents: LegalDocumentId[] = ['terms', 'privacy']): Promise<void> {
  const rows = documents.map((document) => ({ document, version: LEGAL_VERSIONS[document] }));
  const { error } = await backend.from('legal_acceptances').upsert(rows, {
    onConflict: 'user_id,document,version',
    ignoreDuplicates: true,
  });
  if (error) throw new Error(error.message);
}

export async function recordPendingConsent(email: string): Promise<void> {
  if (!email) return;
  const storage = await openSecureStorage();
  const pending = storage.getString(pendingKey(email));
  if (!pending) return;
  try {
    await acceptCurrentVersions();
    storage.remove(pendingKey(email));
  } catch {
    // Retried on next sign-in; the consent gate also catches missing rows.
  }
}

/** Documents whose current version the signed-in user has not accepted. */
export async function missingAcceptances(): Promise<LegalDocumentId[]> {
  const { data, error } = await backend.from('legal_acceptances').select('document, version');
  if (error) throw new Error(error.message);
  const accepted = new Set((data ?? []).map((row) => `${row.document}:${row.version}`));
  return (Object.keys(LEGAL_VERSIONS) as LegalDocumentId[]).filter(
    (document) => !accepted.has(`${document}:${LEGAL_VERSIONS[document]}`),
  );
}
