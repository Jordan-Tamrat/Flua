import "server-only";

import { prisma } from "@/lib/db/client";
import { fakePasswordVerification, hashPassword, verifyPassword } from "@/lib/auth/password";
import type { SessionPayload } from "@/lib/auth/session";
import { EmailAlreadyRegisteredError, InvalidCredentialsError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { LoginInput, RegisterInput } from "@/lib/validation/auth";

/**
 * Account lifecycle: registration and sign-in.
 *
 * Route handlers stay thin by delegating everything here â€” this module owns the
 * transaction boundaries and the security-sensitive decisions.
 */

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
