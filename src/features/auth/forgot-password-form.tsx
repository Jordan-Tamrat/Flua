"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiPost } from "@/lib/api/client";

interface ForgotPasswordResponse {
  submitted: boolean;
  devToken?: string;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await apiPost<ForgotPasswordResponse>("/api/auth/forgot-password", { email });
      setSubmitted(true);
      setDevToken(result.devToken ?? null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Check your email</CardTitle>
          <CardDescription>
            If an account exists for {email}, we&apos;ve created a reset link for it.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {devToken ? (
            // Flua has no mail transport configured, so rather than pretend an
            // email was sent, the link is shown directly in development.
            <Alert variant="warning">
              <AlertTitle>Development mode</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  No email provider is configured, so the reset link is shown here instead of being
                  sent. In production this would be emailed.
                </p>
                <Link
                  href={`/reset-password?token=${encodeURIComponent(devToken)}`}
                  className="text-primary block font-medium break-all hover:underline"
                >
                  Open reset link
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="info">
              <AlertDescription>
                Password reset emails require a mail provider, which isn&apos;t configured in this
                deployment. Ask your administrator to set one up.
              </AlertDescription>
            </Alert>
          )}

          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a link to set a new password.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>

          <p className="text-muted-foreground text-center text-sm">
            <Link
              href="/login"
              className="text-primary focus-visible:outline-ring rounded font-medium hover:underline focus-visible:outline-2"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
