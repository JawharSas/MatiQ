/**
 * Moderation helpers for the function.
 *
 * - Bans: every function refuses banned accounts and requests from banned
 *   networks (`svc_access_denied`; only one-way fingerprints of addresses are
 *   stored, see migration 20261029000500_moderation.sql).
 * - Sexual content the AI finds in match frames or a profile picture bans the
 *   account at once; the files move to the `moderation-quarantine` bucket,
 *   which only the server side can read.
 */

import type { Admin } from './admin.ts';
import type { Safety } from './ai/schemas.ts';
import type { Logger } from './log.ts';

export const QUARANTINE_BUCKET = 'moderation-quarantine';
/** How sure the model must be before an account is banned automatically. */
export const BAN_CONFIDENCE = 0.7;

/** Addresses the request came from, the whole proxy chain included. */
export function requestIps(req: Request): string[] {
  const ips = [req.headers.get('cf-connecting-ip'), req.headers.get('x-real-ip')];
  for (const part of (req.headers.get('x-forwarded-for') ?? '').split(',')) ips.push(part.trim());
  return [...new Set(ips.filter((ip): ip is string => Boolean(ip)))].slice(0, 10);
}

/** True when the account is banned or the request comes from a banned network. */
export async function accessDenied(admin: Admin, userId: string, ips: string[]): Promise<boolean> {
  const { data, error } = await admin.rpc('svc_access_denied', { p_user_id: userId, p_ips: ips });
  if (error) throw new Error(`ban check failed: ${error.message}`);
  return data === true;
}

export function isSexualContent(safety: Safety | null | undefined): boolean {
  return Boolean(safety?.sexualContent) && (safety?.confidence ?? 0) >= BAN_CONFIDENCE;
}

/** Moves files into quarantine under `{owner}/{case}/{bucket}/{name}`. */
export async function quarantine(
  admin: Admin,
  bucket: string,
  paths: string[],
  ownerId: string,
  caseId: string,
  log: Logger,
): Promise<void> {
  for (const path of paths) {
    const target = `${ownerId}/${caseId}/${bucket}/${path.split('/').pop()}`;
    const { error } = await admin.storage.from(bucket).move(path, target, { destinationBucket: QUARANTINE_BUCKET });
    if (error) {
      // Never leave it where people can see it.
      log.warn('quarantine move failed, deleting instead', { bucket, error: error.message });
      await admin.storage.from(bucket).remove([path]);
    }
  }
}

export async function banForSexualContent(admin: Admin, userId: string, what: string, log: Logger): Promise<void> {
  const { error } = await admin.rpc('svc_ban_user', {
    p_user_id: userId,
    p_reason: `Automatic: sexual content in ${what}`,
    p_category: 'sexual_content',
  });
  if (error) throw new Error(`ban failed: ${error.message}`);
  log.warn('account banned for sexual content', { userId, what });
}
