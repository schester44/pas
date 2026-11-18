import type * as React from "react";
import { cn } from "../lib/utils";

/** Centred inside the card that would hold the data. One sentence, at most one action. */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      {icon && (
        <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </span>
      )}
      <p className="m-0 text-sm font-medium">{title}</p>
      {description && <p className="m-0 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export { EmptyState };
