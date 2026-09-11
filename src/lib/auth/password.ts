import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt with a work factor of 12 — a deliberate cost that keeps offline
 * brute-forcing expensive while staying under ~250ms on modest hardware.
 * Plain-text passwords never leave this module.
 */

const SALT_ROUNDS = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plainPassword, hash);
  } catch {
    // A malformed hash must read as "wrong password", never as a crash.
    return false;
  }
}

/**
 * A bcrypt comparison against a throwaway hash.
 *
 * Used on the login path when the email doesn't exist, so that a missing
 * account and a wrong password take the same amount of time. Without this, an
 * attacker can enumerate registered emails by timing the response.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7iN8QhX3l6dpP3ZFqM6Vf.5qJmMEQ4i";

export async function fakePasswordVerification(plainPassword: string): Promise<void> {
  await bcrypt.compare(plainPassword, DUMMY_HASH).catch(() => false);
}
