/**
 * How people reach MatIQ. Release builds read the addresses from repository
 * variables (EXPO_PUBLIC_SUPPORT_EMAIL, EXPO_PUBLIC_DMCA_AGENT_*). Until they
 * are set, nothing points to a made-up address: support falls back to the
 * project's public issue tracker, and copyright notices (which contain
 * personal details) are never sent there.
 */

import { Linking } from 'react-native';
import { env } from '@/config/env';

export const ISSUES_URL = 'https://github.com/JawharSas/MatiQ/issues';

export const supportEmail = env.supportEmail;
export const copyrightAgentEmail = env.dmcaAgent.email ?? env.supportEmail;

/** For legal text: the support address, or the issue tracker. */
export const supportContactText = supportEmail ?? 'the MatIQ issue tracker (github.com/JawharSas/MatiQ/issues)';

export function mailto(to: string, subject: string, body = ''): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}${body ? `&body=${encodeURIComponent(body)}` : ''}`;
}

/** Opens an email to support, or a new public issue when no address is set. */
export function contactSupport(subject: string, body = ''): void {
  const url = supportEmail
    ? mailto(supportEmail, subject, body)
    : `${ISSUES_URL}/new?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${body}\n\n(This page is public: don't include personal details.)`.trim())}`;
  void Linking.openURL(url);
}
