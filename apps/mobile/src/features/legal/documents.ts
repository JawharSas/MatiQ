/**
 * In-app Privacy Policy and Terms of Service.
 *
 * TEMPLATE NOTICE: this text is a starting point written for MatIQ's actual
 * data flows. Have it reviewed by qualified counsel for the jurisdictions you
 * operate in before release, and bump the version whenever it changes - users
 * are asked to accept new versions and every acceptance is recorded.
 */

import { env } from '@/config/env';
import { ISSUES_URL, supportContactText } from './contact';

/** Documents people accept (each acceptance is recorded per version). */
export const LEGAL_VERSIONS = {
  terms: '2026-10-29.2',
  privacy: '2026-10-29.2',
} as const;

export type LegalDocumentId = keyof typeof LEGAL_VERSIONS;

/** Every legal page in the app: the accepted documents plus the Copyright Policy, which the Terms include. */
export type LegalPageId = LegalDocumentId | 'copyright';

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  id: LegalPageId;
  title: string;
  version: string;
  summary: string;
  sections: LegalSection[];
}

const entity = env.legalEntity;
const contact = supportContactText;
const agent = env.dmcaAgent;

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
        'Account data: email address, username, display name, optional bio and profile picture. Profile pictures are re-encoded on your device before upload, which removes location and camera metadata, and are checked for sexual content before anyone else can see them.',
        'Your birth month and year, asked once to check the minimum age. It is never shown on your profile or to other users.',
        'If you sign in with Google: the name and email address of your Google account. We never receive your Google password.',
        'Training content: videos you record or upload, still frames sampled from them for analysis, match details you enter (discipline, titles, athlete labels) and the resulting events, scorecards and coaching notes. Before a video leaves your phone, the app removes the location (GPS) and phone make and model that cameras write into video files.',
        'Social data: friend requests, friendships, blocks, posts and likes.',
        'Ranked play: challenges, confirmed results, ratings, rating history and titles.',
        'Usage and security data: number of analyses per month, rate-limit counters, security logs needed to prevent abuse and, if you turn on two-factor authentication, your authenticator enrollment.',
        'Network data: like any online service, our hosting provider sees the IP address your phone connects from and keeps it in security logs (for example to limit repeated sign-in attempts). IP addresses are never shown to other users, are not part of your profile and are not used for advertising or tracking. If you sign in with Google, or a security check appears at sign-in, Google or Cloudflare also see your IP address for that step.',
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
        'When you request an analysis, still frames sampled from your video are sent over an encrypted connection to our AI provider solely to detect match events and generate your coaching summary. With live analysis, this happens in small batches while you record so the app can show a provisional score. Frames are deleted from our storage after a successful analysis.',
        'The same AI check also looks for sexual content in those frames, and in every profile picture you set, before anyone else can see it (see Moderation and safety).',
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
        'Other users never see your email address, IP address or location. Videos uploaded with app versions before 1.4.1 may still contain location data, so only you can watch them.',
        'Ranked matches: when you record a ranked match, your opponent in that match can watch the recording and its scorecard so they can confirm or dispute the result. Your ranked ratings, record and titles follow your account privacy (everyone for Public accounts, friends only for Private accounts). If a ranked result is disputed, the MatIQ owner may watch that recording to resolve the dispute. This access ends when the dispute is resolved, and the decision is recorded in an audit log.',
      ],
    },
    {
      heading: 'Moderation and safety',
      paragraphs: [
        'Names, bios, match titles, dispute notes and posts are checked automatically against a list of words MatIQ does not allow. A post that matches is not shared. We keep its text (up to 280 characters) as a strike for up to 90 days; three strikes in 30 days ban the account.',
        'Sexual content found by the AI check in a recording or profile picture bans the account straight away. The owner of MatIQ can also ban accounts that break the Terms.',
        'When an account is banned we keep the ban record (reason and date) while the ban lasts, and block the networks the account used in the last 30 days for 30 days. For that we store only one-way fingerprints (keyed hashes) of those IP addresses, which cannot be turned back into addresses, never the addresses themselves.',
        'Content that broke the rules is moved to locked storage that only MatIQ can access, and kept only as long as needed to handle appeals and our legal duties. Where the law requires it, for example for child sexual abuse material, we report it to the authorities (in the United States, NCMEC) and preserve it as the law requires.',
        `If you think a ban is a mistake, contact ${contact}.`,
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
        'We keep your data while your account is active. You can delete individual matches and posts at any time. Deleting your account (Settings > Delete account) permanently removes your profile, matches, videos, analyses, posts, ranked ratings, titles and stored API keys. Rating changes your past opponents received stay in their own history, without a link to you. Encrypted backups expire on our provider\'s backup schedule.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'You can access and export your data (Settings > Export my data), correct your profile, delete your account, and object to or restrict processing where applicable law gives you that right (for example under the GDPR or CCPA/CPRA). Contact us to exercise any right we have not automated.',
      ],
    },
    {
      heading: "Children's privacy",
      paragraphs: [
        'MatIQ is not directed to children under 13 and we do not knowingly collect personal information from children under 13 (or under the higher minimum age where you live). Everyone is asked for their birth month and year before an account can be used.',
        'If the date shows someone is under 13, we do not create the account. If the account was started with Google, we delete it, and everything that came with it, straight away. We do not keep the date that was entered.',
        `If you are a parent or guardian and believe your child under 13 has given us personal information, contact ${contact} and we will delete it.`,
        'People aged 13 to 17 should use MatIQ with the permission of a parent or guardian. New accounts are private by default. Do not record or upload footage of minors without the consent of a parent or legal guardian.',
      ],
    },
    {
      heading: 'Copyright notices',
      paragraphs: [
        'If you send us a copyright notice or counter-notice, we use it to handle the claim, share it with the other party as the law allows, and keep it to apply our repeat-infringer policy. See the Copyright Policy.',
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
        'You must be at least 13 years old, or the minimum age of digital consent in your country if higher.',
        'If you are under 18, you may use MatIQ only with the permission of a parent or legal guardian, who agrees to these Terms for you.',
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
      heading: 'Copyright',
      paragraphs: [
        "Respect other people's copyright. We respond to notices of claimed infringement under the U.S. Digital Millennium Copyright Act as described in our Copyright Policy, which is part of these Terms. We remove infringing material and, in appropriate circumstances, terminate the accounts of repeat infringers.",
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
      heading: 'Community rules',
      paragraphs: [
        'MatIQ is for training. No sexual content or nudity of any kind: it bans the account straight away and permanently. No hate speech, slurs, threats, harassment or encouraging self-harm.',
        'Names, bios, titles, notes and posts are checked automatically, also when letters are spaced out or swapped. A post that breaks the rules is not shared and counts as a strike; three strikes in 30 days ban the account. Recordings and profile pictures are checked by AI.',
        `A ban signs you out, hides everything you posted and blocks the networks you used. Creating a new account to get around a ban is not allowed. If you think a ban is a mistake, contact ${contact}.`,
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
        'You can delete your account at any time. We may suspend or ban accounts that break these Terms. Sections that by their nature should survive termination will survive.',
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

const agentLines = [
  `Name: ${agent.name}`,
  ...(agent.address ? [`Postal address: ${agent.address}`] : agent.email ? [`Postal address: email ${agent.email} and we will send it.`] : []),
  ...(agent.email ? [`Email: ${agent.email}`] : []),
  ...(agent.phone ? [`Phone: ${agent.phone}`] : []),
  ...(!agent.address && !agent.email
    ? [`Contact details: not published yet. Until they are, ask for them at ${ISSUES_URL} (a public page, so leave out personal details).`]
    : []),
];

export const COPYRIGHT_POLICY: LegalDocument = {
  id: 'copyright',
  title: 'Copyright Policy',
  version: '2026-10-29',
  summary:
    'If you believe something on MatIQ infringes your copyright, send a notice to our designated agent. We remove infringing material and close the accounts of repeat infringers.',
  sections: [
    {
      heading: 'Our policy',
      paragraphs: [
        `${entity} respects intellectual property and responds to notices of claimed copyright infringement under the U.S. Digital Millennium Copyright Act (17 U.S.C. § 512). This policy is part of our Terms of Service.`,
      ],
    },
    {
      heading: 'Designated agent',
      paragraphs: [
        'Send copyright notices and counter-notices to our designated agent, registered with the U.S. Copyright Office:',
        ...agentLines,
        'In the app you can also open a post, tap Report and choose Copyright infringement: it starts an email to the agent with the post already identified.',
      ],
    },
    {
      heading: 'What a notice must include',
      paragraphs: [
        '1. A physical or electronic signature of the copyright owner or a person authorised to act for them.',
        '2. Identification of the copyrighted work you claim is infringed (or a representative list if several works are involved).',
        '3. Identification of the material you claim is infringing and enough information for us to find it, such as the post ID from the Report screen or the username and date of the post.',
        '4. Your name, postal address, telephone number and email address.',
        '5. A statement that you have a good-faith belief that the use is not authorised by the copyright owner, its agent or the law.',
        '6. A statement that the information in the notice is accurate and, under penalty of perjury, that you are the owner or authorised to act on the owner\'s behalf.',
      ],
    },
    {
      heading: 'What happens next',
      paragraphs: [
        'When we receive a complete notice we promptly remove or disable access to the material and tell the person who posted it, including a copy of the notice.',
      ],
    },
    {
      heading: 'Counter-notices',
      paragraphs: [
        'If your material was removed and you believe that was a mistake or a misidentification, you can send our agent a counter-notice that includes:',
        '1. Your physical or electronic signature.',
        '2. Identification of the material that was removed and where it appeared before removal.',
        '3. A statement under penalty of perjury that you have a good-faith belief the material was removed as a result of mistake or misidentification.',
        '4. Your name, address and telephone number, and a statement that you consent to the jurisdiction of the U.S. Federal District Court for the judicial district of your address (or, if you are outside the United States, any judicial district in which we may be found), and that you will accept service of process from the person who sent the original notice or their agent.',
        'We forward the counter-notice to the person who sent the original notice. Unless they tell us within 10 business days that they have filed a court action, we may restore the material 10 to 14 business days after receiving the counter-notice.',
      ],
    },
    {
      heading: 'False claims',
      paragraphs: [
        'Anyone who knowingly makes a material misrepresentation in a notice or counter-notice may be liable for damages under 17 U.S.C. § 512(f). If you are not sure whether material infringes your copyright, consider getting legal advice first.',
      ],
    },
    {
      heading: 'Repeat infringers',
      paragraphs: [
        'We keep a record of notices. In appropriate circumstances we suspend and terminate the accounts of people who repeatedly infringe copyright.',
      ],
    },
    {
      heading: 'Other problems',
      paragraphs: [`For anything that is not about copyright, such as harassment or someone filmed without consent, use Report > Something else or write to ${contact}.`],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  privacy: PRIVACY_POLICY,
  terms: TERMS_OF_SERVICE,
};

export const LEGAL_PAGES: Record<LegalPageId, LegalDocument> = {
  ...LEGAL_DOCUMENTS,
  copyright: COPYRIGHT_POLICY,
};
