import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useSettingsNav } from "@/components/settings-nav";

export const Route = createFileRoute("/_authed/settings/")({
  component: SettingsIndex,
});

function SettingsIndex() {
  const first = useSettingsNav()[0]?.items[0];

  if (first) return <Navigate to={first.to} replace />;

  return (
    <>
      <PageHeader title="Settings" />
      <PageBody className="max-w-4xl">
        <Panel flush>
          <EmptyState
            icon={<Settings />}
            title="No settings available"
            description="Ask an admin if you need to manage the team or roles."
          />
        </Panel>
      </PageBody>
    </>
  );
}
