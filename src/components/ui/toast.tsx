"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Minimal toast system.
 *
 * A dedicated toast library would be another dependency for something the app
 * uses in a handful of places, so this is hand-rolled: a context, a stack, and
 * an `aria-live` region so screen readers announce messages as they arrive.
 */

export type ToastVariant = "default" | "success" | "error";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (options: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback(
    ({
      title,
      description,
      variant = "default",
    }: {
      title: string;
      description?: string;
      variant?: ToastVariant;
    }) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, title, description, variant }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 p-4 sm:right-0 sm:bottom-0 sm:left-auto sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((entry) => (
          <ToastCard key={entry.id} toast={entry} onDismiss={() => dismiss(entry.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  default: "border-border bg-card",
  success: "border-success/30 bg-card",
  error: "border-destructive/30 bg-card",
};

const VARIANT_ICONS: Record<ToastVariant, ReactNode> = {
  default: <Info className="text-primary size-4 shrink-0" />,
  success: <CheckCircle2 className="text-success size-4 shrink-0" />,
  error: <AlertCircle className="text-destructive size-4 shrink-0" />,
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      // Errors interrupt; everything else waits for a pause in speech.
      role={toast.variant === "error" ? "alert" : "status"}
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)] items-start gap-3 rounded-xl border p-4 shadow-lg",
        VARIANT_STYLES[toast.variant],
      )}
    >
      {VARIANT_ICONS[toast.variant]}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description ? (
          <p className="text-muted-foreground mt-0.5 text-sm">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring rounded-md focus-visible:outline-2"
      >
        <X className="size-4" />
        <span className="sr-only">Dismiss notification</span>
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside a ToastProvider.");
  }
  return context;
}
