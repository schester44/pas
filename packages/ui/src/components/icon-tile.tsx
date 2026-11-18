import type * as React from "react";
import { cn } from "../lib/utils";

/** The accent's main carrier. One per card header; lists of tiles are for feature lists, not data. */
function IconTile({
  size = "md",
  onTint,
  className,
  children,
}: {
  size?: "sm" | "md";
  onTint?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg text-primary",
        size === "md" ? "size-10 [&_svg]:size-5" : "size-9 [&_svg]:size-4",
        onTint
          ? "bg-background shadow-xs ring-1 ring-primary/15"
          : "bg-primary/10 ring-1 ring-primary/15",
        className,
      )}
    >
      {children}
    </span>
  );
}

export { IconTile };
