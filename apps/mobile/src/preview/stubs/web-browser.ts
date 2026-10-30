/** Browser UI preview: expo-web-browser. The system browser hand-off (Google) succeeds at once. */
export async function openAuthSessionAsync(): Promise<{ type: 'success' }> {
  return { type: 'success' };
}

export function maybeCompleteAuthSession(): { type: 'failed'; message: string } {
  return { type: 'failed', message: 'Not in a browser session' };
}
