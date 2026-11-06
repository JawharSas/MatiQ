import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityTarget, activityText, isNotificationKind } from './activity.ts';

const POST = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('activityTarget', () => {
  it('opens the right screen for each kind', () => {
    assert.deepEqual(activityTarget('friend_request', null, USER), { pathname: '/friends' });
    assert.deepEqual(activityTarget('friend_accepted', null, USER), { pathname: '/user/[id]', params: { id: USER } });
    assert.deepEqual(activityTarget('ranked_result', POST, USER), { pathname: '/ranked/match/[id]', params: { id: POST } });
    assert.deepEqual(activityTarget('post_comment', POST, USER), { pathname: '/comments/[postId]', params: { postId: POST } });
  });

  it('opens nothing for missing or malformed ids (push data is untrusted)', () => {
    assert.equal(activityTarget('post_like', null, USER), null);
    assert.equal(activityTarget('post_like', '../../settings', USER), null);
    assert.equal(activityTarget('friend_accepted', null, 'not-a-uuid'), null);
  });
});

describe('activityText and kinds', () => {
  it('has a sentence for each kind and knows the kinds', () => {
    assert.equal(activityText('post_like'), 'liked your post.');
    assert.equal(isNotificationKind('ranked_challenge'), true);
    assert.equal(isNotificationKind('admin_message'), false);
    assert.equal(isNotificationKind(undefined), false);
  });
});
