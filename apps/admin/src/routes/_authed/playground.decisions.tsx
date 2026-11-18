import type { JdmDecision } from "@pas/decisions-engine";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Label } from "@pas/ui/components/label";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DecisionEditor } from "@/components/decisions/decision-editor";
import { decisionSamples, homeownersSchema } from "./-decision-samples";

export const Route = createFileRoute("/_authed/playground/decisions")({
  component: DecisionsPlayground,
});

function DecisionsPlayground() {
  const [selected, setSelected] = useState(decisionSamples[0]!.id);
  const [readOnly, setReadOnly] = useState(false);

  const [decisions, setDecisions] = useState<Record<string, JdmDecision>>(() =>
    Object.fromEntries(decisionSamples.map((sample) => [sample.id, sample.decision])),
  );

  const sample = decisionSamples.find((s) => s.id === selected)!;

  return (
    <>
      <PageHeader
        title="Decisions playground"
        actions={
          <>
            <Label className="mr-2 font-normal">
              <Checkbox
                checked={readOnly}
                onCheckedChange={(checked) => setReadOnly(checked === true)}
              />
              Read only
            </Label>
            <SegmentedControl
              label="Sample decision"
              value={selected}
              onValueChange={setSelected}
              options={decisionSamples.map((s) => ({ value: s.id, label: s.label }))}
            />
          </>
        }
      />
      <PageBody>
        <DecisionEditor
          key={sample.id}
          kind={sample.kind}
          value={decisions[sample.id]!}
          onChange={(next) => setDecisions((current) => ({ ...current, [sample.id]: next }))}
          schema={homeownersSchema}
          readOnly={readOnly}
          sample={sample.sample}
        />
      </PageBody>
    </>
  );
}
