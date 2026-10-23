import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorMessage } from '@/lib/errors';
import { Caption, Card, ErrorText, Heading, ToggleRow } from '@/ui/components';
import { updateProfile, type Visibility } from './api';

/**
 * Public / Private account switch. Private (the default) restricts posts,
 * shared scorecards and highlights to approved friends; the rule itself is
 * enforced by Row Level Security, this only flips the flag.
 */
export function PrivacyToggle({ userId, visibility }: { userId: string; visibility: Visibility }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (makePublic: boolean) => {
    setPending(true);
    setError(null);
    try {
      await updateProfile(userId, { visibility: makePublic ? 'public' : 'private' });
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <Heading>Account privacy</Heading>
      <ToggleRow
        label="Public account"
        description={
          visibility === 'public'
            ? 'Anyone signed in to MatIQ can see posts you share (except posts marked Friends only).'
            : 'Only friends you approve can see your posts, scorecards and highlights.'
        }
        value={visibility === 'public'}
        onValueChange={(next) => void change(next)}
        disabled={pending}
      />
      <Caption>Your matches and videos stay private to you until you share them in a post.</Caption>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
