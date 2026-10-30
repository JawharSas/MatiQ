/**
 * Profile pictures.
 *
 * The picked photo is square-cropped, downscaled and re-encoded on the device
 * before upload. Re-encoding writes pixels only, so EXIF metadata (GPS
 * location, device model, capture time) never leaves the phone. Avatars live
 * in a private bucket and are shown through short-lived signed URLs.
 *
 * Nobody else sees a new picture until the server has checked it: the app
 * uploads `{user}/pending.jpg` (readable by its owner only) and the
 * `moderation` function publishes it, or removes it. Sexual content bans the
 * account.
 */

import { useQuery } from '@tanstack/react-query';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { type Image, Images } from 'react-native-nitro-image';
import { deleteLocalFile } from '@/features/capture/match-session';
import { toFilePath, toFileUri } from '@/features/capture/frame-processor';
import { AppError, fromFunctionError } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { updateProfile } from './api';

const BUCKET = 'avatars';
const AVATAR_SIZE = 512;
const AVATAR_QUALITY = 85;
const SIGNED_URL_SECONDS = 3600;

/** Center square of an image: the crop rectangle as start/end corners. */
export function centerSquare(width: number, height: number) {
  const size = Math.min(width, height);
  const x = Math.floor((width - size) / 2);
  const y = Math.floor((height - size) / 2);
  return { startX: x, startY: y, endX: x + size, endY: y + size };
}

/** Returns a local JPEG with no metadata, or null when the user cancelled. */
async function pickCleanAvatar(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new AppError('permission_denied', 'MatIQ needs photo access to set a profile picture.');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;

  const original = await Images.loadFromFileAsync(toFilePath(asset.uri));
  // Always redraw: on iOS that applies the EXIF orientation to the pixels
  // (a plain crop would not), and the result carries no metadata.
  const scale = Math.min(1, AVATAR_SIZE / Math.min(original.width, original.height));
  let scaled: Image | undefined;
  let cropped: Image | undefined;
  try {
    scaled = await original.resizeAsync(Math.max(1, Math.round(original.width * scale)), Math.max(1, Math.round(original.height * scale)));
    const square = centerSquare(scaled.width, scaled.height);
    cropped = await scaled.cropAsync(square.startX, square.startY, square.endX, square.endY);
    return toFileUri(await cropped.saveToTemporaryFileAsync('jpg', AVATAR_QUALITY));
  } finally {
    cropped?.dispose();
    scaled?.dispose();
    original.dispose();
  }
}

/**
 * Lets the user pick a photo and sends it for the check. Returns the new
 * storage path once it is published, or null when cancelled. The server
 * deletes the previous avatar.
 */
export async function changeAvatar(userId: string): Promise<string | null> {
  const uri = await pickCleanAvatar();
  if (!uri) return null;
  try {
    const bytes = await new File(uri).arrayBuffer();
    const { error } = await backend.storage
      .from(BUCKET)
      .upload(`${userId}/pending.jpg`, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new AppError('upload_failed', 'Uploading the picture failed');
  } finally {
    deleteLocalFile(uri);
  }
  const { data, error } = await backend.functions.invoke<{ path: string }>('moderation', { body: { action: 'avatar' } });
  if (error) throw await fromFunctionError(error);
  if (!data?.path) throw new AppError('unknown', 'Something went wrong. Please try again.');
  return data.path;
}

export async function removeAvatar(userId: string, path: string): Promise<void> {
  await updateProfile(userId, { avatar_path: null });
  await backend.storage.from(BUCKET).remove([path]);
}

export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['avatar-url', path],
    enabled: Boolean(path),
    // Refresh well before the signed URL expires.
    staleTime: (SIGNED_URL_SECONDS - 600) * 1000,
    gcTime: (SIGNED_URL_SECONDS - 600) * 1000,
    queryFn: async () => {
      const { data, error } = await backend.storage.from(BUCKET).createSignedUrl(path!, SIGNED_URL_SECONDS);
      if (error) return null;
      return data.signedUrl;
    },
  });
}
