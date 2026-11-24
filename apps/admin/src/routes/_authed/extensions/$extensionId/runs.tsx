import { PageBody } from "@pas/ui/components/page";
import { createFileRoute } from "@tanstack/react-router";
import { useExtensionEditor } from "@/components/extensions/extension-editor";
import { type RunFilter, RunsPanel } from "@/components/extensions/runs-panel";

export const Route = createFileRoute("/_authed/extensions/$extensionId/runs")({
  validateSearch: (search: Record<string, unknown>): { run?: string; filter?: RunFilter } => ({
    ...(typeof search.run === "string" && { run: search.run }),
    ...(search.filter === "failed" && { filter: "failed" as const }),
  }),
  component: RunsTab,
});

function RunsTab() {
  const { extension } = useExtensionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = search.filter ?? "all";
  const keep = filter === "failed" ? { filter } : {};

  return (
    <PageBody className="max-w-6xl">
      <RunsPanel
        extensionId={extension.id}
        filter={filter}
        {...(search.run && { runId: search.run })}
        onFilter={(next) => navigate({ search: next === "failed" ? { filter: next } : {} })}
        onOpen={(run) => navigate({ search: { ...keep, run } })}
        onClose={() => navigate({ search: keep })}
      />
    </PageBody>
  );
}
