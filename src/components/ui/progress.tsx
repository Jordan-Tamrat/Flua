"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));

  return (
    <ProgressPrimitive.Root
      className={cn("bg-muted relative h-2 w-full overflow-hidden rounded-full", className)}
      value={clamped}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "bg-primary h-full w-full flex-1 transition-transform duration-500",
          indicatorClassName,
        )}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
