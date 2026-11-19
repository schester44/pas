import type * as React from "react";
import { cn } from "../lib/utils";

/** The sticky 56px page header: the page's only <h1> on the left, page actions on the right. */
function PageHeader({
  title,
  actions,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "sticky top-0 z-10 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6",
        className,
      )}
    >
      <h1 className="m-0 min-w-32 flex-1 truncate text-lg font-semibold tracking-tight">{title}</h1>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Page body with the standard gutter. Cards sit straight in it; don't add another padded wrapper. */
function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-6 p-4 sm:p-6", className)} {...props} />;
}

export { PageBody, PageHeader };
