/**
 * Client-side input validation. Mirrors the database CHECK constraints so
 * users get instant feedback; the database and Edge Functions remain the
 * authority and re-validate everything.
 */

import { z } from 'zod';

// Control characters (except newline/tab where allowed) and bidi overrides
// used for spoofing ("evil‮txt.exe").
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F‎‏‪-‮⁦-⁩]/g;
// eslint-disable-next-line no-control-regex
const UNSAFE_SINGLE_LINE = /[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g;

/** Normalises Unicode and strips characters the database would reject. */
export function cleanText(value: string, { multiline = false } = {}): string {
  return value
    .normalize('NFC')
    .replace(multiline ? UNSAFE : UNSAFE_SINGLE_LINE, '')
    .trim();
}

const singleLine = (max: number, min = 0) =>
  z
    .string()
    .transform((value) => cleanText(value))
    .pipe(z.string().min(min).max(max));

const multiLine = (max: number) =>
  z
    .string()
    .transform((value) => cleanText(value, { multiline: true }))
    .pipe(z.string().max(max));

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,24}$/, '3-24 letters, numbers or underscores');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/\d/, 'Add a number')
  .regex(/[^A-Za-z0-9]/, 'Add a symbol');

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  username: usernameSchema,
  displayName: singleLine(50, 1),
  // The age check (birth month and year) is validated separately in features/legal/age-rule.ts.
  agreed: z.literal(true, { message: 'Tick the box to agree to the Terms of Service and Privacy Policy.' }),
});

export const profileSchema = z.object({
  username: usernameSchema,
  displayName: singleLine(50, 1),
  bio: multiLine(280),
});

export const postSchema = z.object({
  body: multiLine(500),
  friendsOnly: z.boolean(),
});

export const matchSetupSchema = z.object({
  title: singleLine(80),
  athleteALabel: singleLine(40, 1),
  athleteBLabel: singleLine(40, 1),
  athleteAHint: singleLine(80).optional(),
  athleteBHint: singleLine(80).optional(),
});

export const apiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^sk-ant-[A-Za-z0-9_-]{20,250}$/, 'Anthropic keys start with "sk-ant-"'),
  label: singleLine(40).optional(),
});

/** Formats the first zod issue for display next to a form. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}
