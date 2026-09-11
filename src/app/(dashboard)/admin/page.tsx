import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/config/env";
import { getAdminOverview } from "@/server/services/admin-service";

export const metadata: Metadata = {
  title: "Admin",
};

/**
 * Provider and usage dashboard.
 *
 * Restricted to ADMIN_EMAILS, and 404s rather than 403s for everyone else so
 * the page's existence isn't advertised.
 */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!getEnv().ADMIN_EMAILS.includes(session.email.toLowerCase())) {
    notFound();
  }

  const overview = await getAdminOverview();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground text-sm">
          Provider status, AI usage and recent failures.
        </p>
      </header>

      {!overview.config.valid ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Configuration problems</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 space-y-1">
              {overview.config.issues.map((issue) => (
                <li key={issue.variable} className="text-sm">
                  <code className="text-xs">{issue.variable}</code>: {issue.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Providers */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Providers</h2>
        <div className="space-y-3">
          {overview.providers
            .slice()
            .sort((a, b) => (a.order === -1 ? 99 : a.order) - (b.order === -1 ? 99 : b.order))
            .map((provider) => (
              <Card key={provider.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      {provider.configured ? (
                        <CheckCircle2 className="text-success size-4" aria-hidden />
                      ) : (
                        <XCircle className="text-muted-foreground size-4" aria-hidden />
                      )}
                      {provider.name}
                    </CardTitle>

                    <div className="flex items-center gap-2">
                      {provider.order === 0 ? <Badge>Primary</Badge> : null}
                      {provider.order === 1 ? <Badge variant="secondary">Secondary</Badge> : null}
                      {provider.order === 2 ? <Badge variant="muted">Tertiary</Badge> : null}
                      <Badge variant={provider.configured ? "success" : "muted"}>
                        {provider.configured ? "Configured" : "No API key"}
                      </Badge>
                    </div>
                  </div>
                  <CardDescription className="text-xs">
                    {provider.capabilities.join(" · ")}
                  </CardDescription>
                </CardHeader>

                <CardContent>
                  <ul className="space-y-1.5">
                    {provider.models.map((model) => (
                      <li
                        key={model.modelId}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <code className="text-muted-foreground truncate">{model.modelId}</code>
                        <Badge variant="muted" className="shrink-0">
                          {model.costTier}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
        </div>
      </section>

      {/* Usage */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Last 24 hours</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Requests" value={overview.usage.last24h.total} />
          <Stat label="Failed" value={overview.usage.last24h.failed} />
          <Stat label="Failovers" value={overview.usage.last24h.fallbacks} />
          <Stat label="Avg latency" value={`${overview.usage.last24h.avgLatencyMs}ms`} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Input tokens" value={overview.usage.last24h.inputTokens.toLocaleString()} />
          <Stat
            label="Output tokens"
            value={overview.usage.last24h.outputTokens.toLocaleString()}
          />
        </div>

        {overview.usage.byProvider.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">By provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {overview.usage.byProvider.map((row) => (
                  <li key={row.provider} className="flex items-center justify-between text-sm">
                    <span>{row.provider}</span>
                    <span className="text-muted-foreground text-xs">
                      {row.requests} requests · {row.failures} failed · {row.avgLatencyMs}ms
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {overview.usage.byRequestType.length > 0 ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">By request type</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {overview.usage.byRequestType
                  .slice()
                  .sort((a, b) => b.requests - a.requests)
                  .map((row) => (
                    <li key={row.requestType} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground text-xs">{row.requestType}</span>
                      <span className="tabular-nums">{row.requests}</span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {/* Recent events */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Recent provider events</h2>
        {overview.recentEvents.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-border divide-y">
                {overview.recentEvents.map((event) => (
                  <li key={event.id} className="space-y-1 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm">
                        <Badge
                          variant={
                            event.kind === "SUCCESS"
                              ? "success"
                              : event.kind === "ALL_FAILED"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {event.kind}
                        </Badge>
                        {event.provider}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {event.createdAt.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs break-words">{event.message}</p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="text-muted-foreground p-6 text-center text-sm">
              No provider events recorded yet.
            </CardContent>
          </Card>
        )}
      </section>

      {/* Database */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Database</h2>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Users" value={overview.database.users} />
          <Stat label="Conversations" value={overview.database.conversations} />
          <Stat label="Vocabulary" value={overview.database.vocabularyItems} />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{label}</p>
      </CardContent>
    </Card>
  );
}
