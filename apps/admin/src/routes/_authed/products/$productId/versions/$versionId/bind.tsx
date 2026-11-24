import { Label } from "@pas/ui/components/label";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { createFileRoute } from "@tanstack/react-router";
import { useVersionEditor } from "@/components/catalog/version-editor";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/bind")({
  component: BindTab,
});

type Party = "insured" | "producer";

interface Completion {
  disclosures: Party;
  signature: Party;
  payment: Party | "either";
}

const DEFAULT: Completion = { disclosures: "producer", signature: "producer", payment: "producer" };

const PARTY: Record<Party, string> = {
  insured: "Insured, from a link the producer sends",
  producer: "Producer, in the agent app",
};

const STEPS: {
  step: keyof Completion;
  label: string;
  description: string;
  options: Record<string, string>;
}[] = [
  {
    step: "disclosures",
    label: "Accepts the disclosures",
    description: "The attestations on the details step.",
    options: PARTY,
  },
  {
    step: "signature",
    label: "Signs the application",
    description: "Typed e-signature on the reviewed packet.",
    options: PARTY,
  },
  {
    step: "payment",
    label: "Pays the down payment",
    description: "Direct bill only. Agency and mortgagee bill always bind from the agent app.",
    options: { ...PARTY, either: "Either the insured or the producer" },
  },
];

/** Who completes each step before bind (`lifecycle.completion`), each set on its own. */
function BindTab() {
  const { contents, set, readOnly } = useVersionEditor();
  const completion: Completion = { ...DEFAULT, ...(contents.lifecycle.completion as object) };

  const update = (patch: Partial<Completion>) =>
    set("lifecycle", { ...contents.lifecycle, completion: { ...completion, ...patch } });

  return (
    <PageBody className="max-w-4xl">
      <Panel
        flush
        title="Who completes the application"
        description="Steps the insured owns wait for them; the producer sends a link and sees their progress."
      >
        <div className="divide-y">
          {STEPS.map(({ step, label, description, options }) => (
            <div
              key={step}
              className="flex flex-wrap items-center justify-between gap-4 px-(--card-p) py-3"
            >
              <div className="grid gap-0.5">
                <Label htmlFor={`completion-${step}`} className="leading-5">
                  {label}
                </Label>
                <p className="m-0 text-xs text-muted-foreground">{description}</p>
              </div>
              <Select
                value={completion[step]}
                disabled={readOnly}
                onValueChange={(value) => update({ [step]: value })}
              >
                <SelectTrigger id={`completion-${step}`} className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(options).map(([value, text]) => (
                    <SelectItem key={value} value={value}>
                      {text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Panel>
    </PageBody>
  );
}
