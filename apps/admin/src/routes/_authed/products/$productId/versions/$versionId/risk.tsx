import { PageBody } from "@pas/ui/components/page";
import { createFileRoute } from "@tanstack/react-router";
import { RiskSchemaBuilder } from "@/components/builders/risk-schema-builder";
import { useVersionEditor } from "@/components/catalog/version-editor";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/risk")({
  component: RiskTab,
});

function RiskTab() {
  const { contents, readOnly, set } = useVersionEditor();

  return (
    <PageBody>
      <RiskSchemaBuilder
        value={contents.riskSchema}
        onChange={(next) => set("riskSchema", next)}
        readOnly={readOnly}
      />
    </PageBody>
  );
}
