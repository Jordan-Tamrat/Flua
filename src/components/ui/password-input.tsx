"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a reveal toggle.
 *
 * Typing a long passphrase blind is where most sign-in mistakes come from, so
 * the toggle matters more here than it looks. Two details make it behave:
 *
 *  * The button is `tabIndex={-1}`. Tabbing from the password field should go to
 *    the submit button, not detour through an optional control.
 *  * Revealing switches the input to `type="text"`, which some password managers
 *    read as a new field. `autoComplete` is still forwarded by the caller so the
 *    browser keeps treating it as the password it is.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [isVisible, setIsVisible] = useState(false);
  const Icon = isVisible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? "text" : "password"}
        // Room for the button, so a long password never runs underneath it.
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setIsVisible((current) => !current)}
        disabled={props.disabled}
        aria-label={isVisible ? "Hide password" : "Show password"}
        aria-pressed={isVisible}
        className={cn(
          "text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg transition-colors",
          "focus-visible:outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </div>
  );
}
