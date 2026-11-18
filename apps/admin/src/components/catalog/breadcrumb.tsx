import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

export function Breadcrumb({
  parents,
  current,
}: {
  parents: React.ReactNode[];
  current?: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {parents.map((parent, i) => (
        <Fragment key={i}>
          <span className="shrink-0 font-medium text-muted-foreground transition-colors [&_a]:outline-none [&_a:hover]:text-foreground [&_a:focus-visible]:text-foreground">
            {parent}
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/70" />
        </Fragment>
      ))}
      {current === undefined ? (
        <span className="h-4 w-32 animate-pulse rounded bg-muted" />
      ) : (
        <span className="flex min-w-0 items-center gap-2.5 truncate">{current}</span>
      )}
    </span>
  );
}
