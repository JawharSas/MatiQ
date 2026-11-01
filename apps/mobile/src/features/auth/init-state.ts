export function authInitializing({
  isClerkLoaded,
  clerkLoadTimedOut,
  clerkUserId,
  userId,
  accountError,
}: {
  isClerkLoaded: boolean;
  clerkLoadTimedOut: boolean;
  clerkUserId: string | null;
  userId: string | null;
  accountError: Error | null;
}): boolean {
  const waitingForClerk = !isClerkLoaded && !clerkLoadTimedOut;
  const openingAccount = Boolean(clerkUserId && !userId && !accountError);
  return waitingForClerk || openingAccount;
}
