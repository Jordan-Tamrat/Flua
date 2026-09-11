import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-muted-foreground max-w-md">
          That page doesn&apos;t exist, or it isn&apos;t yours to see.
        </p>
      </div>

      <Button asChild>
        <Link href="/learn">Back to your dashboard</Link>
      </Button>
    </div>
  );
}
