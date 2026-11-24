import { PageBody, PageHeader } from "@pas/ui/components/page";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { type RunFilter, RunsPanel } from "@/components/extensions/runs-panel";

export const Route = createFileRoute("/_authed/extensions/runs")({
  validateSearch: (search: Record<string, unknown>): { run?: string; filter: RunFilter } => ({
    ...(typeof search.run === "string" && { run: search.run }),
    filter: search.filter === "all" ? "all" : "failed",
  }),
  component: AllRunsPage,
});

/** Every extension's runs, failures first by default: where to look when something breaks. */
function AllRunsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { filter } = search;
  const keep = { filter };

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="extensions" to="/extensions">
                Extensions
              </Link>,
            ]}
            current="Runs"
          />
        }
      />
      <PageBody className="max-w-6xl">
        <RunsPanel
          filter={filter}
          {...(search.run && { runId: search.run })}
          onFilter={(next) => navigate({ search: { filter: next } })}
          onOpen={(run) => navigate({ search: { ...keep, run } })}
          onClose={() => navigate({ search: keep })}
        />
      </PageBody>
    </>
  );
}
