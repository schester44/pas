import type { AdminOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { PolicyStatus } from "@/components/policies/policy-status";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/")({
  component: PoliciesPage,
});

type Policy = AdminOutputs["policies"]["list"][number];

export const termLabel = (policy: Pick<Policy, "effectiveDate" | "expirationDate">) =>
  `${formatPlainDate(policy.effectiveDate)} – ${formatPlainDate(policy.expirationDate)}`;

function PoliciesPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const policies = useQuery(trpc.policies.list.queryOptions({ limit: 200 }));

  const open = (policy: Policy) =>
    navigate({ to: "/policies/$policyId", params: { policyId: policy.id } });

  return (
    <>
      <PageHeader title="Policies" />
      <PageBody className="max-w-6xl">
        <Panel flush>
          {policies.error ? (
            <EmptyState
              icon={<ScrollText />}
              title="Couldn't load policies"
              description="Refresh the page to try again."
            />
          ) : policies.data?.length === 0 ? (
            <EmptyState
              icon={<ScrollText />}
              title="No policies yet"
              description="Quotes bound in the app show up here."
            />
          ) : (
            <>
              <Table className="hidden lg:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Policy</TableHead>
                    <TableHead>Insured</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Term</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Premium</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {policies.isPending &&
                    Array.from({ length: 3 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}>
                          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {policies.data?.map((policy) => (
                    <TableRow
                      key={policy.id}
                      className="h-13 cursor-pointer hover:bg-muted/40"
                      onClick={() => open(policy)}
                    >
                      <TableCell>
                        <Link
                          to="/policies/$policyId"
                          params={{ policyId: policy.id }}
                          className="font-medium tabular-nums outline-none hover:underline focus-visible:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {policy.number}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-48 truncate">{policy.insuredName}</TableCell>
                      <TableCell className="text-muted-foreground">{policy.productName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {jurisdictionShort(policy.jurisdiction)}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {termLabel(policy)}
                      </TableCell>
                      <TableCell>
                        <PolicyStatus status={policy.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(policy.writtenPremium)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ul className="m-0 list-none divide-y p-0 lg:hidden">
                {policies.data?.map((policy) => (
                  <li key={policy.id}>
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: policy.id }}
                      className="grid gap-1 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm leading-5 font-medium">
                          {policy.insuredName}
                        </span>
                        <PolicyStatus status={policy.status} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {policy.number} · {policy.productName} ·{" "}
                        {jurisdictionShort(policy.jurisdiction)} · {termLabel(policy)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
