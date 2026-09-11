import { z } from "zod";

/** Shared auth input schemas. Used by both route handlers and client forms. */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

/**
 * Password rules are deliberately length-first: a long passphrase beats a short
 * password stuffed with symbols, and complexity rules push people toward
 * predictable substitutions.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters — a short phrase works well.")
  .max(200, "That password is too long.")
  .refine((value) => value.trim().length > 0, "Enter a password.");

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Tell us what to call you.").max(80, "That name is too long."),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "This reset link is not valid."),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
