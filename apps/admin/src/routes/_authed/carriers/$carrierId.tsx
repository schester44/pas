import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { StatusChip } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { MODES } from "@/components/carriers/labels";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId")({
  component: CarrierLayout,
});

const TABS = [
  { to: "/carriers/$carrierId", label: "Overview", exact: true },
  { to: "/carriers/$carrierId/connections", label: "Connections" },
  { to: "/carriers/$carrierId/connector", label: "Connector" },
  { to: "/carriers/$carrierId/console", label: "Test console" },
  { to: "/carriers/$carrierId/feeds", label: "File feeds" },
] as const;

function CarrierLayout() {
  const { carrierId } = Route.useParams();
  const trpc = useTRPC();
  const carrier = useQuery(trpc.carriers.get.queryOptions({ id: carrierId }));

  const parents = [
    <Link key="carriers" to="/carriers">
      Carriers
    </Link>,
  ];

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={parents}
            current={
              carrier.data ? (
                <>
                  <span className="truncate">{carrier.data.name}</span>
                  <StatusChip tone="neutral">{MODES[carrier.data.mode]}</StatusChip>
                </>
              ) : undefined
            }
          />
        }
      />
      <nav
        aria-label="Carrier"
        className="-mb-px flex gap-5 overflow-x-auto border-b bg-background px-4 sm:px-6"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ carrierId }}
            activeOptions={{ exact: "exact" in tab }}
            className={cn(
              "flex h-11 shrink-0 items-center border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              "[&.active]:border-primary [&.active]:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {carrier.error ? (
        <PageBody className="max-w-6xl">
          <Notice tone="error" title="Couldn't load this carrier">
            {carrier.error.message}
          </Notice>
        </PageBody>
      ) : (
        <Outlet />
      )}
    </>
  );
}
