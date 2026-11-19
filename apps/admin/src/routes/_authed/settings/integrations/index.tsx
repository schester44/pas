import type { AdminOutputs } from "@pas/api-client";
import { Card } from "@pas/ui/components/card";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CATEGORIES,
  CertifiedMark,
  InstallState,
  ProviderLogo,
  providerByline,
} from "@/components/integrations";
import { RegulatoryCoverage } from "@/components/compliance/regulatory-coverage";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/integrations/")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const trpc = useTRPC();
  const list = useQuery(trpc.integrations.list.queryOptions());

  const groups = Object.keys(CATEGORIES)
    .map((category) => ({
      category,
      integrations: (list.data?.integrations ?? []).filter((i) => i.category === category),
    }))
    .filter((group) => group.integrations.length > 0);

  return (
    <>
      <PageHeader title="Integrations" />
      <PageBody className="max-w-6xl gap-8">
        {list.data?.sandbox && (
          <Notice title="Sandboxes use test mode only">
            Live accounts can't be connected here, and providers without a test mode are replaced by
            their built-in test version.
          </Notice>
        )}
        {list.error ? (
          <Notice tone="error" title="Couldn't load integrations">
            {list.error.message}
          </Notice>
        ) : !list.data ? (
          <CatalogSkeleton />
        ) : (
          groups.map((group) => (
            <section key={group.category} className="grid gap-4">
              <div className="grid gap-1">
                <h2 className="m-0 text-base leading-6 font-semibold">
                  {CATEGORIES[group.category]!.label}
                </h2>
                <p className="m-0 text-sm text-muted-foreground">
                  {CATEGORIES[group.category]!.port}
                </p>
              </div>
              <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
                {group.integrations.map((integration) => (
                  <li key={integration.id} className="flex">
                    <IntegrationCard integration={integration} />
                  </li>
                ))}
              </ul>
              {group.category === "filing" && (
                <RegulatoryCoverage integrations={group.integrations} />
              )}
            </section>
          ))
        )}
      </PageBody>
    </>
  );
}

function IntegrationCard({
  integration,
}: {
  integration: AdminOutputs["integrations"]["list"]["integrations"][number];
}) {
  const byline = providerByline(integration);

  return (
    <Card className="w-full transition-colors focus-within:ring-[3px] focus-within:ring-ring/50 hover:bg-muted/40">
      <Link
        to="/settings/integrations/$providerId"
        params={{ providerId: integration.id }}
        className="flex h-full flex-col gap-3 rounded-xl p-(--card-p) outline-none"
      >
        <div className="flex items-center gap-3">
          <ProviderLogo logo={integration.logo} />
          <div className="grid min-w-0 gap-0.5">
            <span className="truncate text-sm leading-5 font-medium">{integration.name}</span>
            {byline && <span className="truncate text-xs text-muted-foreground">{byline}</span>}
          </div>
        </div>
        <p className="m-0 line-clamp-2 text-sm text-muted-foreground">{integration.summary}</p>
        <div className="mt-auto flex h-6 items-center justify-between gap-2 pt-1">
          <InstallState integration={integration} />
          {integration.certified && !integration.builtin && <CertifiedMark />}
        </div>
      </Link>
    </Card>
  );
}

function CatalogSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
      ))}
    </div>
  );
}
