import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, it } from 'node:test';
import { fcmBody, parseServiceAccount, signedAssertion } from './fcm.ts';
import { allowed, cleanName, pushMessage } from './push-messages.ts';

const ids = { id: 'n1', subjectId: 'p1', actorId: 'a1' };

describe('pushMessage', () => {
  it('names who did what, with what the app needs to open it', () => {
    const message = pushMessage('post_comment', 'Sam Okafor', ids);
    assert.equal(message.title, 'New comment');
    assert.equal(message.body, 'Sam Okafor commented on your post.');
    assert.deepEqual(message.data, { notificationId: 'n1', kind: 'post_comment', actorId: 'a1', subjectId: 'p1' });
  });

  it('leaves out a missing subject', () => {
    assert.equal('subjectId' in pushMessage('friend_request', 'Sam', { ...ids, subjectId: null }).data, false);
  });

  it('cleans names: control characters out, 40 characters at most, "Someone" when empty', () => {
    assert.equal(cleanName('Sam\u0007 Okafor'), 'Sam Okafor');
    assert.equal(cleanName('x'.repeat(60)).length, 40);
    assert.equal(cleanName('   '), 'Someone');
    assert.equal(cleanName(null), 'Someone');
  });
});

describe('allowed', () => {
  it('follows the switch for each kind, and everything is on without settings', () => {
    assert.equal(allowed('post_like', null), true);
    assert.equal(allowed('post_like', { likes: false, comments: true }), false);
    assert.equal(allowed('post_comment', { likes: false, comments: true }), true);
    assert.equal(allowed('ranked_result', { ranked: false }), false);
    assert.equal(allowed('friend_accepted', { friend_requests: true }), true);
  });
});

describe('FCM', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const keyFile = JSON.stringify({ type: 'service_account', project_id: 'matiq-test', client_email: 'push@matiq-test.iam.gserviceaccount.com', private_key: pem });

  it('reads the service account key file and refuses incomplete ones', () => {
    assert.equal(parseServiceAccount(keyFile).projectId, 'matiq-test');
    assert.throws(() => parseServiceAccount('{'), /not JSON/);
    assert.throws(() => parseServiceAccount(JSON.stringify({ project_id: 'matiq-test', client_email: 'a@b' })), /private_key/);
  });

  it('signs an assertion Google can verify, for the messaging scope, valid for an hour', async () => {
    const jwt = await signedAssertion(parseServiceAccount(keyFile), 1_800_000_000);
    const [header, claims, signature] = jwt.split('.');
    const decode = (part: string) => JSON.parse(Buffer.from(part!, 'base64url').toString());
    assert.deepEqual(decode(header!), { alg: 'RS256', typ: 'JWT' });
    assert.deepEqual(decode(claims!), {
      iss: 'push@matiq-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const verify = createVerify('RSA-SHA256');
    verify.update(`${header}.${claims}`);
    assert.equal(verify.verify(publicKey, Buffer.from(signature!, 'base64url')), true);
  });

  it('sends a high-priority notification with its data to one phone', () => {
    const body = fcmBody('phone-token', pushMessage('ranked_challenge', 'Maya', ids));
    assert.equal(body.message.token, 'phone-token');
    assert.equal(body.message.notification.body, 'Maya challenged you to a ranked match.');
    assert.equal(body.message.android.priority, 'high');
    assert.equal(body.message.data.kind, 'ranked_challenge');
  });
});
