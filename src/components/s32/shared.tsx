// =====================================================================
// §32 — shared UI primitives for the user-facing panels.
//
// Every §32 panel composes these so states are consistent across the
// programme: loading (skeleton), empty, error, permission-denied, and
// the standing disclosure notes required by the backend contracts.
// Actions NEVER show success before the mutation resolves (each panel
// awaits the real backend call and only then toasts).
// =====================================================================
import type { ReactNode } from "react";
import { Inbox, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Permission-denied state — rendered when a capability/role check fails. */
export function AuthWall({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div>
        <p className="text-sm font-medium">{message}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** Empty state — consistent across §32 panels. */
export function S32Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 p-8 text-center">
      <Inbox className="size-5 text-muted-foreground/70" />
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** Inline loading row. */
export function S32Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </p>
  );
}

/**
 * Standing disclosure note (the yellow "review aid" strips). Used for the
 * conflict-review disclaimer, filing-readiness no-acceptance note, machine
 * translation label, redaction coverage note, etc. — the backend carries
 * the text; the UI must never swallow it.
 */
export function S32Note({
  children,
  tone = "amber",
  className,
}: {
  children: ReactNode;
  tone?: "amber" | "blue" | "red";
  className?: string;
}) {
  const tones: Record<string, string> = {
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200",
    blue: "border-blue-500/40 bg-blue-500/5 text-blue-900 dark:text-blue-200",
    red: "border-red-500/40 bg-red-500/5 text-red-900 dark:text-red-200",
  };
  return (
    <p
      className={cn(
        "rounded-md border px-3 py-2 text-xs leading-relaxed",
        tones[tone],
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Standard error → toast helper for §32 actions (mirrors ProposalReviewPanel). */
export function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
