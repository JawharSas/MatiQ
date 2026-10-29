import type { VideoCheckPassed } from '@matiq/rules-engine/media';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Body, Button, Caption, Card, ErrorText, ProgressBar, StatusText } from '@/ui/components';
import { MAX_VIDEO_BYTES, scanVideo, videoRejectedMessage } from './video-check';

export interface PickedVideo {
  uri: string;
  durationMs: number;
  mimeType: 'video/mp4' | 'video/quicktime';
  sizeBytes: number | null;
  /** Result of the full file check, so the upload doesn't repeat it. */
  verified: VideoCheckPassed;
}

function detectMime(asset: ImagePicker.ImagePickerAsset): PickedVideo['mimeType'] | null {
  const mime = asset.mimeType?.toLowerCase();
  if (mime === 'video/mp4' || mime === 'video/quicktime') return mime;
  const name = (asset.fileName ?? asset.uri).toLowerCase();
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return null;
}

/**
 * Lets the user pick a pre-recorded sparring video and checks it on the
 * phone before any upload: type, length and size, then the whole file is
 * read to confirm it is a genuine MP4 / MOV video with nothing else inside.
 * The server checks the uploaded copy again and re-checks the length.
 */
export function VideoUploader({
  maxDurationMs,
  onPicked,
  onCancel,
}: {
  maxDurationMs: number;
  onPicked: (video: PickedVideo) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<number | null>(null);

  const pick = async () => {
    setError(null);
    setBusy(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Allow photo library access to pick a video.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        allowsMultipleSelection: false,
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;

      const mimeType = detectMime(asset);
      const durationMs = Math.round(asset.duration ?? 0);
      if (!mimeType) return setError('Only MP4 and MOV videos are supported.');
      if (durationMs < 1000) return setError('This video is too short to analyse.');
      if (durationMs > maxDurationMs) {
        return setError(`Videos can be up to ${Math.floor(maxDurationMs / 60000)} minutes. Trim it and try again.`);
      }
      if (asset.fileSize && asset.fileSize > MAX_VIDEO_BYTES) return setError('Videos must be smaller than 500 MB.');

      setChecking(0);
      const verified = await scanVideo(asset.uri, { onProgress: setChecking });
      if (!verified.ok) return setError(videoRejectedMessage(verified));
      onPicked({
        uri: asset.uri,
        durationMs,
        mimeType: verified.container === 'mov' ? 'video/quicktime' : 'video/mp4',
        sizeBytes: asset.fileSize ?? null,
        verified,
      });
    } catch {
      setError('This video could not be read. Try another video.');
    } finally {
      setChecking(null);
      setBusy(false);
    }
  };

  return (
    <Card>
      <Body>Choose a sparring video from your library. MP4 or MOV, up to {Math.floor(maxDurationMs / 60000)} minutes.</Body>
      <Caption>Frames are sampled on your device; only the frames (and, if you choose, the video) are uploaded.</Caption>
      {checking !== null ? (
        <>
          <StatusText>Checking the video…</StatusText>
          <ProgressBar label="Checking the video" value={checking} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button label="Choose video" onPress={() => void pick()} loading={busy} />
      <Button label="Back" variant="secondary" onPress={onCancel} />
    </Card>
  );
}
