import type * as React from "react";
import { cn } from "../lib/utils";
import { Card } from "./card";

interface PanelProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header action, usually a small ghost or outline button. */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** No content padding: for tables and divide-y settings rows. */
  flush?: boolean;
}

/** A titled card. See docs/design.md §3. */
function Panel({
  title,
  description,
  action,
  footer,
  flush,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <section {...props}>
        {(title || action) && (
          <header className="flex items-start justify-between gap-4 border-b px-(--card-p) py-4">
            <div className="grid min-w-0 gap-1">
              {title && <h2 className="m-0 text-base leading-6 font-semibold">{title}</h2>}
              {description && <p className="m-0 text-sm text-muted-foreground">{description}</p>}
            </div>
            {action && <div className="-my-1 shrink-0">{action}</div>}
          </header>
        )}
        <div className={cn(!flush && "p-(--card-p)")}>{children}</div>
        {footer && <footer className="border-t bg-muted/50 px-(--card-p) py-3">{footer}</footer>}
      </section>
    </Card>
  );
}

export { Panel };
