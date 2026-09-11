"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/components/theme-script";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["light", "dark", "system"];

const LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Cycles light → dark → system.
 *
 * The stored theme is browser state that lives outside React, so it is read
 * through `useSyncExternalStore` rather than mirrored into an effect. That also
 * gives a correct server snapshot ("system"), avoiding a hydration mismatch.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing the theme should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function getSnapshot(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // Private browsing can block storage access entirely.
    return "system";
  }
}

/** The server can't know the stored preference, so it always renders "system". */
function getServerSnapshot(): Theme {
  return "system";
}

function applyTheme(next: Theme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (next !== "system") {
    root.classList.add(next);
  }

  try {
    if (next === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    }
  } catch {
    // The preference just won't persist; the current page still reflects it.
  }

  notify();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function cycle() {
    const nextIndex = (ORDER.indexOf(theme) + 1) % ORDER.length;
    applyTheme(ORDER[nextIndex]!);
  }

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      title={`Theme: ${LABELS[theme]}`}
      aria-label={`Change theme. Currently ${LABELS[theme].toLowerCase()}.`}
    >
      <Icon className="size-4" aria-hidden />
    </Button>
  );
}
