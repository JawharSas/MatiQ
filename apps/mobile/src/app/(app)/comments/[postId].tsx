'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import {
  COMMENT_MAX_LENGTH,
  type PostComment,
  useAddComment,
  useComments,
  useCommentState,
  useDeleteComment,
  useSetCommentsEnabled,
} from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { timeAgo } from '@/features/social/PostCard';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Card, EmptyState, ErrorText, LinkPressable, Loading, Screen, TextField, ToggleRow, withPressFeedback } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * A post's comments. Anyone who can see the post can comment while its author
 * allows it; the author can turn comments off or on here at any time and
 * delete any comment on the post. Comments already there stay when they're off.
 */
export default function CommentsScreen() {
  useTheme();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const id = typeof postId === 'string' ? postId : '';
  const viewerId = useUserId();
  const state = useCommentState(id);
  const comments = useComments(id);
  const add = useAddComment(id);
  const remove = useDeleteComment(id);
  const setEnabled = useSetCommentsEnabled(id);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isAuthor = state.data?.author_id === viewerId;
  const open = state.data?.comments_enabled ?? true;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setError(null);
    try {
      await add.mutateAsync(text);
      setDraft('');
    } catch (caught) {
      setError(errorMessage(caught));
      // The author may have just turned comments off: show it.
      void state.refetch();
    }
  };

  if (state.isPending && comments.isPending) return <Loading label="Loading comments" />;
  if (state.isSuccess && state.data === null) {
    return (
      <Screen>
        <EmptyState icon="eye-off-outline" title="Post not available" body="It was deleted, or it's no longer shared with you." />
      </Screen>
    );
  }

  return (
    <Screen>
      {isAuthor ? (
        <Card>
          <ToggleRow
            label="Allow comments"
            description={open ? 'Anyone who can see this post can comment.' : 'Nobody can add comments. The ones here stay.'}
            value={open}
            onValueChange={(value) => {
              setError(null);
              setEnabled.mutate(value, { onError: (caught) => setError(errorMessage(caught)) });
            }}
            disabled={setEnabled.isPending}
          />
        </Card>
      ) : null}

      {open ? (
        <Card>
          <TextField
            label="Add a comment"
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={COMMENT_MAX_LENGTH}
            placeholder="Say something about this round"
          />
          <Button label="Post comment" icon="send" onPress={send} loading={add.isPending} disabled={draft.trim().length === 0} />
        </Card>
      ) : (
        <View style={styles.closed}>
          <Ionicons aria-hidden name="lock-closed-outline" size={18} color={colors.textMuted} />
          <Body muted>{isAuthor ? 'You turned off comments on this post.' : 'The author turned off comments on this post.'}</Body>
        </View>
      )}
      <ErrorText>{error}</ErrorText>

      {comments.isPending ? (
        <Loading label="Loading comments" inline />
      ) : comments.isError ? (
        <ErrorText>{errorMessage(comments.error)}</ErrorText>
      ) : comments.data.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="No comments yet"
          body={open ? 'Be the first: say what stood out in this round.' : undefined}
        />
      ) : (
        <Card>
          {comments.data.map((comment, index) => (
            <CommentRow
              key={comment.comment_id}
              comment={comment}
              first={index === 0}
              onDelete={comment.can_delete ? () => remove.mutate(comment.comment_id, { onError: (caught) => setError(errorMessage(caught)) }) : undefined}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function CommentRow({ comment, first, onDelete }: { comment: PostComment; first: boolean; onDelete?: () => void }) {
  useTheme();
  return (
    <View style={[styles.comment, !first && styles.divider]}>
      <Link href={{ pathname: '/user/[id]', params: { id: comment.author_id } }} asChild>
        <LinkPressable accessibilityRole="link" accessibilityLabel={`${comment.display_name}'s profile`} style={styles.avatar}>
          <Avatar path={comment.avatar_path} name={comment.display_name} size={36} />
        </LinkPressable>
      </Link>
      <View style={styles.commentBody}>
        <Text style={styles.name} numberOfLines={1}>
          {comment.display_name} <Text style={font.caption}>· {timeAgo(comment.created_at)}</Text>
        </Text>
        <Text style={font.body}>{comment.body}</Text>
      </View>
      {onDelete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${comment.display_name}'s comment`}
          onPress={onDelete}
          style={withPressFeedback(styles.delete)}
          hitSlop={4}
        >
          <Ionicons aria-hidden name="trash-outline" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  closed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.xs },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  avatar: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  commentBody: { flex: 1, gap: 2, paddingTop: 2 },
  name: { ...font.body, fontWeight: '700' },
  delete: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
}));
