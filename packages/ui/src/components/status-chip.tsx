import type * as React from "react";
import { cn } from "../lib/utils";

const TONES = {
  neutral: { chip: "bg-muted text-foreground border-transparent", dot: "bg-muted-foreground/60" },
  accent: { chip: "bg-primary/5 text-foreground border-primary/15", dot: "bg-primary" },
  success: { chip: "bg-emerald-50 text-emerald-900 border-emerald-200", dot: "bg-emerald-500" },
  warning: { chip: "bg-amber-50 text-amber-900 border-amber-200", dot: "bg-amber-500" },
  danger: { chip: "bg-red-50 text-red-900 border-red-200", dot: "bg-red-500" },
} as const;

export type StatusTone = keyof typeof TONES;

/** A dot and a word, for state you scan down a column. */
function StatusChip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone].chip,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONES[tone].dot)} />
      {children}
    </span>
  );
}

export { StatusChip };
