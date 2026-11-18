import { Card } from "@pas/ui/components/card";
import { EmptyState } from "@pas/ui/components/empty-state";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/")({
  component: HomePage,
});

function HomePage() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <>
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          {firstName ? `Hi, ${firstName}` : "Welcome"}
        </h1>
        <p className="m-0 text-sm text-muted-foreground">
          Your quotes and policies will show up here.
        </p>
      </div>
      <Card>
        <EmptyState
          icon={<FileText />}
          title="No quotes yet"
          description="Start a quote to see it here."
        />
      </Card>
    </>
  );
}
