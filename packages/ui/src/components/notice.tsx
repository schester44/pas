import { CircleAlert, Info } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

/** A titled one-sentence message: failed requests, environment notes. */
function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : Info;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5 text-sm",
        tone === "error" ? "border-red-200 bg-red-50 text-red-900" : "bg-muted/50 text-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "error" ? "text-red-600" : "text-muted-foreground",
        )}
      />
      <div className="grid gap-0.5">
        {title && <p className="m-0 font-medium">{title}</p>}
        {children && (
          <div
            className={cn(title && (tone === "error" ? "text-red-800" : "text-muted-foreground"))}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export { Notice };
