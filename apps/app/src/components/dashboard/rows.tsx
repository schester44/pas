import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";

const ROW =
  "group flex items-center gap-4 px-(--card-p) py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40";

export function DashboardRows({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <ul className="m-0 list-none divide-y p-0">
      {pending &&
        Array.from({ length: 3 }, (_, index) => (
          <li key={index} className="grid gap-2 px-(--card-p) py-4">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 animate-pulse rounded bg-muted/70" />
          </li>
        ))}
      {children}
    </ul>
  );
}

export function RowLink({
  to,
  children,
}: {
  to: { kind: "submission" | "policy"; id: string };
  children: React.ReactNode;
}) {
  const chevron = (
    <ChevronRight
      aria-hidden
      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
    />
  );

  return to.kind === "submission" ? (
    <Link to="/submissions/$submissionId" params={{ submissionId: to.id }} className={ROW}>
      {children}
      {chevron}
    </Link>
  ) : (
    <Link to="/policies/$policyId" params={{ policyId: to.id }} className={ROW}>
      {children}
      {chevron}
    </Link>
  );
}
