import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db/client";
import { fakePasswordVerification, hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SessionPayload } from "@/lib/auth/session";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from "@/lib/validation/auth";

/**
 * Account lifecycle: registration, sign-in, and password reset.
 *
 * Route handlers stay thin by delegating everything here — this module owns the
 * transaction boundaries and the security-sensitive decisions.
 */

const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

/** Reset tokens are stored as SHA-256 digests so a DB leak can't be replayed. */
function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerUser(input: RegisterInput): Promise<SessionPayload> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new EmailAlreadyRegisteredError();
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      // A profile always exists alongside a user, so every downstream read can
      // assume it rather than defensively creating one.
      profile: { create: {} },
    },
    select: { id: true, email: true, name: true },
  });

  logger.info("User registered", { userId: user.id });

  return { userId: user.id, email: user.email, name: user.name };
}

export async function authenticateUser(input: LoginInput): Promise<SessionPayload> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, name: true, passwordHash: true },
  });

  if (!user) {
    // Spend the same time as a real verification so response timing doesn't
    // reveal whether the email is registered.
    await fakePasswordVerification(input.password);
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return { userId: user.id, email: user.email, name: user.name };
}

/**
 * Starts a password reset.
 *
 * Always resolves the same way whether or not the email exists — otherwise the
 * endpoint becomes an account-enumeration oracle. The caller gets the token
 * only in development, where there is no mail transport wired up.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput,
): Promise<{ devToken?: string }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (!user) {
    logger.info("Password reset requested for unknown email");
    return {};
  }

  const token = randomBytes(32).toString("base64url");

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  logger.info("Password reset token issued", { userId: user.id });

  // No mail provider is configured in the MVP. Rather than pretend an email was
  // sent, the token is surfaced in development only so the flow is testable;
  // in production it is withheld and the UI explains the limitation.
  return process.env.NODE_ENV === "production" ? {} : { devToken: token };
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const tokenHash = hashResetToken(input.token);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new ValidationError("This reset link has expired or has already been used.");
  }

  const passwordHash = await hashPassword(input.password);

  // Consuming the token and changing the password must succeed or fail
  // together, so a crash can't leave a live token beside a changed password.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Any other outstanding tokens for this account are now stale.
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  logger.info("Password reset completed", { userId: record.userId });
}
