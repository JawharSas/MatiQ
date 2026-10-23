/**
 * In-app Privacy Policy and Terms of Service.
 *
 * TEMPLATE NOTICE: this text is a starting point written for MatIQ's actual
 * data flows. Have it reviewed by qualified counsel for the jurisdictions you
 * operate in before release, and bump the version whenever it changes - users
 * are asked to accept new versions and every acceptance is recorded.
 */

import { env } from '@/config/env';

export const LEGAL_VERSIONS = {
  terms: '2026-10-23',
  privacy: '2026-10-23',
} as const;

export type LegalDocumentId = keyof typeof LEGAL_VERSIONS;

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  title: string;
  version: string;
  summary: string;
  sections: LegalSection[];
}

const entity = env.legalEntity;
const contact = env.supportEmail;

export const PRIVACY_POLICY: LegalDocument = {
  id: 'privacy',
  title: 'Privacy Policy',
  version: LEGAL_VERSIONS.privacy,
  summary:
    'We store your profile, sparring videos and analysis results only to run the app and show you your performance analytics. We never sell your data and never share it with data brokers.',
  sections: [
    {
      heading: 'Our core commitment',
      paragraphs: [
        `${entity} does not sell, rent or trade your personal data, profile, videos or analytics, and never shares them with third-party data brokers or advertisers. This applies to every account, free or paid.`,
      ],
    },
    {
      heading: 'What we collect',
      paragraphs: [
        'Account data: email address, username, display name, optional bio and avatar.',
        'Training content: videos you record or upload, still frames sampled from them for analysis, match details you enter (discipline, titles, athlete labels) and the resulting events, scorecards and coaching notes.',
        'Social data: friend requests, friendships, blocks, posts and likes.',
        'Usage and security data: number of analyses per month, rate-limit counters, and security logs needed to prevent abuse.',
        'Optional API keys you choose to store for "bring your own key" analysis (encrypted, see below).',
      ],
    },
    {
      heading: 'How we use it',
      paragraphs: [
        'To provide the app: storing your matches, running the AI analysis you request, computing scorecards, showing your dashboard and powering the social features you use.',
        'To keep the service safe: authentication, fraud and abuse prevention, rate limiting and enforcing usage limits.',
        'We do not use your videos to build advertising profiles and we do not show third-party ads.',
      ],
    },
    {
      heading: 'AI processing',
      paragraphs: [
        'When you request an analysis, still frames sampled from your video are sent over an encrypted connection to our AI provider solely to detect match events and generate your coaching summary. Frames are deleted from our storage after a successful analysis.',
        'We only use AI providers whose commercial terms prohibit using customer content to train their models. When you analyse with your own API key, your provider account and its terms apply to that request.',
      ],
    },
    {
      heading: 'Service providers',
      paragraphs: [
        'We use a small number of processors under data-processing agreements, only to operate the app: our database, authentication and storage host, and our AI analysis provider. They may only process data on our instructions. The current list is available on request.',
      ],
    },
    {
      heading: 'Who can see your content',
      paragraphs: [
        'New accounts are Private. Private accounts: posts, shared scorecards and highlights are visible only to friends you approve. Public accounts: shared posts are visible to all signed-in MatIQ users, unless you mark a post Friends only.',
        'Your matches, videos and analyses stay visible only to you unless you share them in a post. Your profile card (username, display name, avatar, bio) is visible to signed-in users so friends can find you. Blocking a user hides your profile and content from them.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: [
        'All traffic uses TLS. Data, videos and backups are encrypted at rest by our hosting provider. Your session tokens are stored on your device in an encrypted store whose key is protected by the device keychain or keystore.',
        'API keys you store are encrypted with AES-256-GCM using a key held only by our server functions; they are never displayed back to you, logged or stored on your device. Access to account data by our staff is limited, logged and audited.',
      ],
    },
    {
      heading: 'Retention and deletion',
      paragraphs: [
        'We keep your data while your account is active. You can delete individual matches and posts at any time. Deleting your account (Settings > Delete account) permanently removes your profile, matches, videos, analyses, posts and stored API keys. Encrypted backups expire on our provider\'s backup schedule.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You can access and export your data (Settings > Export my data), correct your profile, delete your account, and object to or restrict processing where applicable law gives you that right (for example under the GDPR or CCPA/CPRA). Contact us to exercise any right we have not automated.',
      ],
    },
    {
      heading: 'Children',
      paragraphs: [
        'MatIQ is not intended for children under 13 (or the higher minimum age required in your country). Do not record or upload footage of minors without the consent of a parent or legal guardian.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions or requests: ${contact}. We will notify you in the app before material changes take effect.`],
    },
  ],
};

export const TERMS_OF_SERVICE: LegalDocument = {
  id: 'terms',
  title: 'Terms of Service',
  version: LEGAL_VERSIONS.terms,
  summary:
    'Use MatIQ to analyse your own training. Only upload footage you have the right to share, and remember that AI scoring is an estimate, not an official decision.',
  sections: [
    {
      heading: 'Agreement',
      paragraphs: [`By creating an account you agree to these Terms and to our Privacy Policy. ${entity} provides MatIQ.`],
    },
    {
      heading: 'Eligibility',
      paragraphs: [
        'You must be at least 13 years old, or the minimum age of digital consent in your country if higher, and able to form a binding agreement.',
      ],
    },
    {
      heading: 'Your content and consent of others',
      paragraphs: [
        'You keep ownership of the videos and content you upload. You grant us a limited licence to store, process and display it only to operate the app for you and the audience you choose.',
        'Sparring footage shows other people. You confirm that everyone identifiable in footage you record or upload has agreed to being recorded, analysed and, if you post it, shared with your chosen audience. Remove content promptly if someone withdraws consent.',
      ],
    },
    {
      heading: 'Your data is not for sale',
      paragraphs: [
        'We do not sell your data or share it with data brokers. See the Privacy Policy for the limited service providers that process data on our behalf.',
      ],
    },
    {
      heading: 'AI analysis is an estimate',
      paragraphs: [
        'Scorecards, statistics and coaching notes are generated automatically from sampled frames and may be wrong. They are training aids, not official refereeing or judging decisions, and must not be relied on for safety, medical or competition purposes.',
      ],
    },
    {
      heading: 'Training safety',
      paragraphs: [
        'Combat sports carry a risk of injury. Train under qualified supervision and stop when you are hurt. MatIQ does not provide medical advice.',
      ],
    },
    {
      heading: 'Acceptable use',
      paragraphs: [
        'Do not upload content you do not have the right to share, harass or expose other users, attempt to access data that is not yours, scrape the service, reverse engineer it to bypass security or usage limits, or interfere with its operation.',
      ],
    },
    {
      heading: 'Usage limits and API keys',
      paragraphs: [
        'Free accounts include a monthly number of AI analyses. We may change limits with notice. If you store your own AI provider key, you are responsible for charges on your provider account.',
      ],
    },
    {
      heading: 'Termination',
      paragraphs: [
        'You can delete your account at any time. We may suspend accounts that break these Terms. Sections that by their nature should survive termination will survive.',
      ],
    },
    {
      heading: 'Disclaimers and liability',
      paragraphs: [
        'The service is provided "as is" to the extent permitted by law. Nothing in these Terms limits liability that cannot be limited under applicable law.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions about these Terms: ${contact}.`],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_SERVICE,
};
