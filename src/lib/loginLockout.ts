/**
 * Client-side brute-force protection for the login form.
 *
 * Rules:
 *   - 3 failed attempts  -> locked for 1 minute
 *   - every 2 failed attempts after that -> locked for 10 minutes
 *
 * State is kept per email address in localStorage so a lockout survives a page
 * reload. This is a deterrent layer only; Supabase Auth also rate limits sign-in
 * attempts on the server, which is what actually stops a determined attacker.
 */

const STORAGE_PREFIX = 'farmvest.login.lockout.';

const FIRST_LOCK_THRESHOLD = 3;
const FIRST_LOCK_MS = 60 * 1000;
const REPEAT_LOCK_EVERY = 2;
const REPEAT_LOCK_MS = 10 * 60 * 1000;

type LockoutState = {
  failures: number;
  lockedUntil: number | null;
};

const emptyState: LockoutState = { failures: 0, lockedUntil: null };

const storageKey = (email: string) => `${STORAGE_PREFIX}${email.trim().toLowerCase()}`;

const readState = (email: string): LockoutState => {
  if (!email.trim()) return { ...emptyState };

  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return { ...emptyState };

    const parsed = JSON.parse(raw) as Partial<LockoutState>;
    return {
      failures: typeof parsed.failures === 'number' ? parsed.failures : 0,
      lockedUntil: typeof parsed.lockedUntil === 'number' ? parsed.lockedUntil : null,
    };
  } catch {
    return { ...emptyState };
  }
};

const writeState = (email: string, state: LockoutState) => {
  try {
    localStorage.setItem(storageKey(email), JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private browsing); the lockout simply does not persist.
  }
};

/** Milliseconds left on the current lockout, or 0 when the email is not locked. */
export const getLockoutRemainingMs = (email: string): number => {
  const { lockedUntil } = readState(email);
  if (!lockedUntil) return 0;

  const remaining = lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
};

export const isLockedOut = (email: string): boolean => getLockoutRemainingMs(email) > 0;

/**
 * Records a failed sign-in attempt and returns how long the email is locked for,
 * in milliseconds (0 when the attempt did not trigger a lockout).
 */
export const registerFailedAttempt = (email: string): number => {
  const state = readState(email);
  const failures = state.failures + 1;

  let lockMs = 0;
  if (failures === FIRST_LOCK_THRESHOLD) {
    lockMs = FIRST_LOCK_MS;
  } else if (
    failures > FIRST_LOCK_THRESHOLD &&
    (failures - FIRST_LOCK_THRESHOLD) % REPEAT_LOCK_EVERY === 0
  ) {
    lockMs = REPEAT_LOCK_MS;
  }

  writeState(email, {
    failures,
    lockedUntil: lockMs > 0 ? Date.now() + lockMs : state.lockedUntil,
  });

  return lockMs;
};

/** Clears the attempt counter after a successful sign-in. */
export const clearFailedAttempts = (email: string) => {
  try {
    localStorage.removeItem(storageKey(email));
  } catch {
    // Ignore storage errors.
  }
};

/** Attempts left before the next lockout kicks in. */
export const getAttemptsBeforeLockout = (email: string): number => {
  const { failures } = readState(email);

  if (failures < FIRST_LOCK_THRESHOLD) {
    return FIRST_LOCK_THRESHOLD - failures;
  }

  const sinceFirstLock = failures - FIRST_LOCK_THRESHOLD;
  return REPEAT_LOCK_EVERY - (sinceFirstLock % REPEAT_LOCK_EVERY);
};

/** Formats a remaining duration as a short human-readable string. */
export const formatRemaining = (ms: number): string => {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
};
