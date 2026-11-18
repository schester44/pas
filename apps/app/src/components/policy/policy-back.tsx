import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export function PolicyBack({ policyId, number }: { policyId: string; number?: string }) {
  return (
    <Link
      to="/policies/$policyId"
      params={{ policyId }}
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground tabular-nums transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" /> {number ?? "Policy"}
    </Link>
  );
}
