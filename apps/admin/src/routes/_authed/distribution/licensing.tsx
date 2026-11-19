import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";
import { useState } from "react";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/distribution/licensing")({
  component: LicensingPage,
});

type Mode = "block" | "warn" | "off";

const MODES = [
  { value: "block" as const, label: "Block" },
  { value: "warn" as const, label: "Warn" },
  { value: "off" as const, label: "Off" },
];

function LicensingPage() {
  const trpc = useTRPC();
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const requirements = useQuery(trpc.distribution.rules.requirements.queryOptions());

  return (
    <>
      <PageHeader title="Licensing" />
      <PageBody className="max-w-4xl">
        <Panel
          flush
          title="Producer license checks"
          description="At quote and bind, the producer of record needs a license in the risk state with one of these lines of authority."
        >
          {products.data?.length === 0 ? (
            <EmptyState icon={<BadgeCheck />} title="No products yet" />
          ) : !products.data || !requirements.data ? (
            <div className="m-(--card-p) h-24 animate-pulse rounded-lg bg-muted/60" />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {products.data.map((product) => (
                <RequirementRow
                  key={product.id}
                  product={product}
                  requirement={requirements.data.find((r) => r.productId === product.id)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
    </>
  );
}

function RequirementRow({
  product,
  requirement,
}: {
  product: { id: string; name: string; lineOfBusiness: string };
  requirement: { mode: Mode; linesOfAuthority: string[] } | undefined;
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(requirement?.mode ?? "off");
  const [lines, setLines] = useState(requirement?.linesOfAuthority.join(", ") ?? "");

  const save = useMutation(
    trpc.distribution.rules.saveRequirement.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.distribution.rules.pathKey() }),
    }),
  );

  const dirty =
    mode !== (requirement?.mode ?? "off") ||
    lines !== (requirement?.linesOfAuthority.join(", ") ?? "");

  return (
    <li className="grid gap-3 px-(--card-p) py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="grid gap-0.5">
        <span className="text-sm leading-5 font-medium">{product.name}</span>
        <span className="text-xs text-muted-foreground">
          {mode === "block"
            ? "Unlicensed producers can't bind."
            : mode === "warn"
              ? "Unlicensed producers see a warning and can bind."
              : "No license check."}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label={`${product.name} license check`}
          value={mode}
          onValueChange={setMode}
          options={MODES}
        />
        <Input
          aria-label="Lines of authority"
          placeholder="Lines of authority"
          value={lines}
          disabled={mode === "off" || !access.agencies.write}
          className="h-8 w-48"
          onChange={(e) => setLines(e.target.value)}
        />
        {access.agencies.write && (
          <Button
            size="sm"
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate({
                productId: product.id,
                mode,
                linesOfAuthority: lines
                  .split(",")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
          >
            {save.isPending && <Spinner />}
            Save
          </Button>
        )}
      </div>
    </li>
  );
}
