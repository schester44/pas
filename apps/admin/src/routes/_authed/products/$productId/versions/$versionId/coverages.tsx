import { indexSchema, type RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import {
  formatAmount,
  type OptionSet,
  OptionSetEditor,
} from "@/components/catalog/option-set-editor";
import { type Coverage, useVersionEditor } from "@/components/catalog/version-editor";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/coverages")({
  validateSearch: (search: Record<string, unknown>): { coverage?: number } => {
    const coverage = Number(search.coverage);

    return Number.isInteger(coverage) && coverage >= 0 ? { coverage } : {};
  },
  component: CoveragesTab,
});

const POLICY = "policy";
const DEFAULT_CURRENCY = "USD";

const toCode = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 64);

interface Exposure {
  path: string;
  label: string;
}

function exposuresOf(schema: RiskSchema): Exposure[] {
  return [...indexSchema(schema).values()]
    .filter((node) => (node.kind === "group" || node.kind === "repeatable") && node.exposure)
    .map((node) => ({
      path: node.path,
      label: `${node.kind === "repeatable" ? "Each" : "The"} ${"exposure" in node ? node.exposure : node.label}`,
    }));
}

function AttachmentLabel({
  coverage,
  exposures,
}: {
  coverage: Coverage;
  exposures: readonly Exposure[];
}) {
  if (coverage.attachesTo.level === "policy") return "Policy";

  const path = coverage.attachesTo.path;
  const exposure = exposures.find((e) => e.path === path);

  if (exposure) return exposure.label;

  return <span className="font-mono text-xs text-destructive">{path}</span>;
}

function OptionSummary({ set }: { set: OptionSet | undefined }) {
  const option = set?.options[set.defaultIndex];

  if (!set || !option) return <span className="text-muted-foreground">–</span>;

  return (
    <span className="tabular-nums">
      {formatAmount(option)}
      {set.options.length > 1 && (
        <span className="text-muted-foreground"> · {set.options.length} options</span>
      )}
    </span>
  );
}

function CoveragesTab() {
  const { contents, readOnly, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const coverages = contents.coverages;
  const exposures = useMemo(() => exposuresOf(contents.riskSchema), [contents.riskSchema]);

  const selectedIndex =
    search.coverage !== undefined && search.coverage < coverages.length
      ? search.coverage
      : coverages.length > 0
        ? 0
        : undefined;

  const selected = selectedIndex === undefined ? undefined : coverages[selectedIndex];

  const select = (coverage: number) => navigate({ search: { coverage }, replace: true });
  const save = (next: Coverage[], immediate?: boolean) => set("coverages", next, immediate);

  function add() {
    save(
      [
        ...coverages,
        { code: "", name: "", attachesTo: { level: "policy" }, required: false, dependsOn: [] },
      ],
      true,
    );

    select(coverages.length);
  }

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={add}>
      <Plus /> Add coverage
    </Button>
  );

  return (
    <PageBody className="max-w-6xl">
      <Panel
        title="Coverages"
        description="What can be bought, where it attaches, and the limits and deductibles offered."
        action={coverages.length > 0 && addAction}
        flush
      >
        {coverages.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title="No coverages yet"
            description="Add the coverages this version offers, at the policy level or per exposure."
            action={addAction}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Coverage</TableHead>
                <TableHead>Attaches to</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Deductible</TableHead>
                <TableHead>Depends on</TableHead>
                <TableHead className="text-right">Required</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coverages.map((coverage, i) => (
                <TableRow
                  key={i}
                  aria-selected={i === selectedIndex}
                  onClick={() => select(i)}
                  className={cn(
                    "cursor-pointer",
                    i === selectedIndex ? "bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span
                        className={cn("font-medium", !coverage.name && "text-muted-foreground")}
                      >
                        {coverage.name || "Untitled coverage"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {coverage.code || "–"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <AttachmentLabel coverage={coverage} exposures={exposures} />
                  </TableCell>
                  <TableCell>
                    <OptionSummary set={coverage.limitOptions} />
                  </TableCell>
                  <TableCell>
                    <OptionSummary set={coverage.deductibleOptions} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {coverage.dependsOn.length
                      ? coverage.dependsOn
                          .map((code) => coverages.find((c) => c.code === code)?.name || code)
                          .join(", ")
                      : "–"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {coverage.required ? "Required" : "Optional"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selected && selectedIndex !== undefined && (
        <CoverageEditor
          key={selectedIndex}
          coverage={selected}
          others={coverages.filter((_, i) => i !== selectedIndex)}
          exposures={exposures}
          readOnly={readOnly}
          onChange={(next) => save(coverages.map((c, i) => (i === selectedIndex ? next : c)))}
          onRemove={() => {
            const removed = selected.code;

            save(
              coverages
                .filter((_, i) => i !== selectedIndex)
                .map((c) => ({ ...c, dependsOn: c.dependsOn.filter((code) => code !== removed) })),
              true,
            );

            navigate({ search: {}, replace: true });
          }}
        />
      )}
    </PageBody>
  );
}

function CoverageEditor({
  coverage,
  others,
  exposures,
  readOnly,
  onChange,
  onRemove,
}: {
  coverage: Coverage;
  others: readonly Coverage[];
  exposures: readonly Exposure[];
  readOnly: boolean;
  onChange: (next: Coverage) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [removing, setRemoving] = useState(false);
  const [codeFollowsName] = useState(!coverage.code);
  const update = (changes: Partial<Coverage>) => onChange({ ...coverage, ...changes });

  const attachValue = coverage.attachesTo.level === "policy" ? POLICY : coverage.attachesTo.path;

  const missingPath =
    coverage.attachesTo.level === "exposure" && !exposures.some((e) => e.path === attachValue);

  const candidates = others.filter((c) => c.code);

  const currency =
    [coverage.limitOptions, coverage.deductibleOptions]
      .flatMap((set) => set?.options ?? [])
      .find((option) => option.kind === "money")?.currency ?? DEFAULT_CURRENCY;

  return (
    <Panel
      title={coverage.name || "Untitled coverage"}
      action={
        !readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setRemoving(true)}
          >
            Remove
          </Button>
        )
      }
    >
      <div className="grid gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-name`} label="Name">
            <Input
              id={`${id}-name`}
              value={coverage.name}
              disabled={readOnly}
              autoFocus={!coverage.name && !readOnly}
              placeholder="Water backup"
              onChange={(event) => {
                const name = event.target.value;
                const follow = codeFollowsName && coverage.code === toCode(coverage.name);
                update(follow ? { name, code: toCode(name) } : { name });
              }}
            />
          </Field>
          <Field id={`${id}-code`} label="Code">
            <Input
              id={`${id}-code`}
              value={coverage.code}
              disabled={readOnly}
              className="font-mono"
              onChange={(event) => update({ code: event.target.value })}
            />
          </Field>
          <Field id={`${id}-description`} label="Description" optional className="sm:col-span-2">
            <Textarea
              id={`${id}-description`}
              value={coverage.description ?? ""}
              disabled={readOnly}
              className="min-h-16"
              onChange={(event) => update({ description: event.target.value || undefined })}
            />
          </Field>
          <Field id={`${id}-attaches`} label="Attaches to">
            <Select
              value={attachValue}
              disabled={readOnly}
              onValueChange={(value) =>
                update({
                  attachesTo:
                    value === POLICY ? { level: "policy" } : { level: "exposure", path: value },
                })
              }
            >
              <SelectTrigger id={`${id}-attaches`} aria-invalid={missingPath}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={POLICY} description="Once per policy">
                  Policy
                </SelectItem>
                {(exposures.length > 0 || missingPath) && <SelectSeparator />}
                {exposures.map((exposure) => (
                  <SelectItem key={exposure.path} value={exposure.path} description={exposure.path}>
                    {exposure.label}
                  </SelectItem>
                ))}
                {missingPath && (
                  <SelectItem value={attachValue} description="Not in the risk data">
                    {attachValue}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-end pb-2">
            <Label className="font-normal">
              <Checkbox
                checked={coverage.required}
                disabled={readOnly}
                onCheckedChange={(checked) => update({ required: checked === true })}
              />
              Required on every quote
            </Label>
          </div>
        </div>

        <div className="grid gap-6 border-t pt-6 sm:grid-cols-2">
          <Field id={`${id}-limits`} label="Limits">
            <OptionSetEditor
              id={`${id}-limits`}
              noun="limit"
              value={coverage.limitOptions}
              currency={currency}
              readOnly={readOnly}
              onChange={(limitOptions) => update({ limitOptions })}
            />
          </Field>
          <Field id={`${id}-deductibles`} label="Deductibles">
            <OptionSetEditor
              id={`${id}-deductibles`}
              noun="deductible"
              value={coverage.deductibleOptions}
              currency={currency}
              readOnly={readOnly}
              onChange={(deductibleOptions) => update({ deductibleOptions })}
            />
          </Field>
        </div>

        <fieldset className="m-0 grid gap-3 border-0 border-t p-0 pt-6">
          <legend className="contents text-sm font-medium">Depends on</legend>
          <p className="m-0 -mt-1 text-sm text-muted-foreground">
            Can only be added when these coverages are on the quote.
          </p>
          {candidates.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No other coverages yet.</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {candidates.map((other) => (
                <Label key={other.code} className="font-normal">
                  <Checkbox
                    checked={coverage.dependsOn.includes(other.code)}
                    disabled={readOnly}
                    onCheckedChange={(checked) =>
                      update({
                        dependsOn:
                          checked === true
                            ? [...coverage.dependsOn, other.code]
                            : coverage.dependsOn.filter((code) => code !== other.code),
                      })
                    }
                  />
                  {other.name || other.code}
                </Label>
              ))}
            </div>
          )}
          {coverage.dependsOn
            .filter((code) => !candidates.some((c) => c.code === code))
            .map((code) => (
              <p key={code} className="m-0 text-xs text-destructive">
                Depends on {code}, which doesn't exist.{" "}
                {!readOnly && (
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() =>
                      update({ dependsOn: coverage.dependsOn.filter((c) => c !== code) })
                    }
                  >
                    Remove
                  </button>
                )}
              </p>
            ))}
        </fieldset>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${coverage.name || "this coverage"}`}
        description="Coverages that depend on it no longer will."
        confirmLabel="Remove coverage"
        onConfirm={onRemove}
      />
    </Panel>
  );
}

function Field({
  id,
  label,
  optional,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
    </div>
  );
}
