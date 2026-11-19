import { PageBody, PageHeader } from "@pas/ui/components/page";
import { createFileRoute } from "@tanstack/react-router";
import { StatementsTable } from "@/components/billing/statements";

export const Route = createFileRoute("/_authed/billing/statements/")({
  component: AgencyStatementsPage,
});

function AgencyStatementsPage() {
  return (
    <>
      <PageHeader title="Agency statements" />
      <PageBody className="max-w-6xl">
        <StatementsTable />
      </PageBody>
    </>
  );
}
