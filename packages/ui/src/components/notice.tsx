import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

/** A titled one-sentence message: failed requests, environment notes. */
function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : tone === "warning" ? TriangleAlert : Info;

  const tones = {
    info: {
      box: "bg-muted/50 text-foreground",
      icon: "text-muted-foreground",
      body: "text-muted-foreground",
    },
    warning: {
      box: "border-amber-200 bg-amber-50 text-amber-900",
      icon: "text-amber-600",
      body: "text-amber-800",
    },
    error: {
      box: "border-red-200 bg-red-50 text-red-900",
      icon: "text-red-600",
      body: "text-red-800",
    },
  }[tone];

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-lg border px-3 py-2.5 text-sm", tones.box, className)}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tones.icon)} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        {title && <p className="m-0 font-medium">{title}</p>}
        {children && <div className={cn(title && tones.body)}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export { Notice };
