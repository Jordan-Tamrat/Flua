import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:top-4 [&>svg]:left-4 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground border-border",
        info: "border-primary/25 bg-primary/8 text-foreground [&>svg]:text-primary",
        success: "border-success/25 bg-success/8 text-foreground [&>svg]:text-success",
        warning: "border-warning/30 bg-warning/10 text-foreground [&>svg]:text-warning",
        destructive:
          "border-destructive/30 bg-destructive/8 text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<"h5">) {
  return (
    <h5 className={cn("mb-1 leading-none font-medium tracking-tight", className)} {...props} />
  );
}

export function AlertDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("text-muted-foreground [&_p]:leading-relaxed", className)} {...props} />
  );
}
