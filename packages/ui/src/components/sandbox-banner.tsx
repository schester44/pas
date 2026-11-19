import type * as React from "react";
import { cn } from "../lib/utils";

/** A thin strip above the whole app so a sandbox can't be mistaken for production. */
function SandboxBanner({
  name,
  time,
  action,
  className,
}: {
  name: React.ReactNode;
  time?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex h-8 shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 text-xs text-amber-900",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      <span className="shrink-0 font-medium">Sandbox</span>
      <span className="min-w-0 truncate text-amber-800">{name}</span>
      {time && <span className="hidden tabular-nums text-amber-800 sm:inline">· {time}</span>}
      {action && <span className="shrink-0 whitespace-nowrap">{action}</span>}
    </div>
  );
}

export { SandboxBanner };
