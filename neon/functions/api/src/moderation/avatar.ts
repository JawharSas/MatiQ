/**
 * Profile-picture check. The app uploads `avatars/{user}/pending.jpg`, which
 * only its owner can read; nothing is shown to other people until the AI
 * check passes and the picture is published under a new name.
 *
 * The upload is first moved to that new name, which the app can't write, and
 * only then read and checked: replacing `pending.jpg` during the check can't
 * swap the picture that gets published.
 */

import type { Admin } from '../shared/admin.ts';
import type { AnalysisProvider } from '../shared/ai/types.ts';
import { toBase64 } from '../shared/crypto.ts';
import { HttpError } from '../shared/http.ts';
import type { Logger } from '../shared/log.ts';
import { banForSexualContent, isSexualContent, quarantine } from '../shared/moderation.ts';
import { isJpeg } from '@matiq/rules-engine/media';

export const AVATARS_BUCKET = 'avatars';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Checks and publishes the pending picture; returns its new path.
 * `provider` is null when the platform AI key is not configured: the picture
 * is then discarded, never published unchecked.
 */
export async function checkAvatar(
  admin: Admin,
  userId: string,
  provider: AnalysisProvider | null,
  log: Logger,
): Promise<string> {
  const pending = `${userId}/pending.jpg`;
  const storage = admin.storage.from(AVATARS_BUCKET);
  const discard = () => storage.remove([pending]);

  if (!provider) {
    await discard();
    throw new HttpError(503, 'moderation_unavailable', 'Picture checks are not set up yet');
  }

  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error: moveError } = await storage.move(pending, path);
  if (moveError) throw new HttpError(404, 'not_found', 'Upload the picture first');
  const reject = async () => {
    await storage.remove([path]);
    throw new HttpError(422, 'image_rejected', 'This picture could not be used');
  };

  const { data: file, error } = await storage.download(path);
  if (error || !file) return await reject();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_BYTES || !isJpeg(bytes)) return await reject();

  let safety;
  try {
    safety = await provider.checkImage(toBase64(bytes));
  } catch (error) {
    await storage.remove([path]);
    throw error;
  }
  if (isSexualContent(safety)) {
    await quarantine(admin, AVATARS_BUCKET, [path], userId, `avatar-${crypto.randomUUID()}`, log);
    await banForSexualContent(admin, userId, 'a profile picture', log);
    throw new HttpError(403, 'banned', 'This account is banned from MatIQ');
  }
  if (!safety) return await reject();

  const { data: previous, error: publishError } = await admin.rpc('svc_publish_avatar', { p_user_id: userId, p_path: path });
  if (publishError) {
    await storage.remove([path]);
    throw new Error(`setting the picture failed: ${publishError.message}`);
  }
  if (typeof previous === 'string' && previous !== path) await storage.remove([previous]);
  return path;
}
