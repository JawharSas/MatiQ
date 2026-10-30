/** "1.7.0" style versions, compared part by part (1.10.0 is newer than 1.9.0). */

const parts = (version: string): number[] | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim().replace(/-.*$/, ''));
  return match ? match.slice(1).map(Number) : null;
};

/** True when `current` is older than `minimum`. Anything unreadable never blocks. */
export function isOlderThan(current: string | null | undefined, minimum: string | null | undefined): boolean {
  const a = current ? parts(current) : null;
  const b = minimum ? parts(minimum) : null;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}
