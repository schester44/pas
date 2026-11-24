import type { RatingEngineKind } from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { cn } from "@pas/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { FileSpreadsheet, Puzzle, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import type { RatingSearch } from "@/components/catalog/issues";
import { type RatingConfig, useVersionEditor } from "@/components/catalog/version-editor";
import { ExtensionRaterEditor } from "@/components/rating/extension-rater-editor";
import { GoldenCases } from "@/components/rating/golden-cases";
import { currencyOf, newManifest, newPlan, sampleInput } from "@/components/rating/model";
import { PlanEditor } from "@/components/rating/plan-editor";
import { SpreadsheetEditor } from "@/components/rating/spreadsheet-editor";
import { sourceOf, useRatingCheck, useRatingPreview } from "@/components/rating/use-rating";
import { Worksheet } from "@/components/rating/worksheet";
import { useAccess } from "@/lib/permissions";

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/rating")({
  validateSearch: (search: Record<string, unknown>): RatingSearch => ({
    ...(search.section === "golden" && { section: "golden" as const }),
    ...(text(search.table) && { table: text(search.table) }),
    ...(text(search.coverage) && { coverage: text(search.coverage) }),
    ...(text(search.golden) && { golden: text(search.golden) }),
    ...(search.settings === true && { settings: true }),
  }),
  component: RatingTab,
});

const ENGINES: Record<
  RatingEngineKind,
  { label: string; description: string; icon: typeof Workflow }
> = {
  plan: {
    label: "Rating plan",
    description: "Rate tables and step-by-step algorithms, configured here.",
    icon: Workflow,
  },
  spreadsheet: {
    label: "Spreadsheet",
    description: "The actuary's .xlsx rater, bound to the risk data.",
    icon: FileSpreadsheet,
  },
  extension: {
    label: "Extension",
    description: "A published extension prices it, for raters neither engine can express.",
    icon: Puzzle,
  },
};

const GENERATED = "generated";

function RatingTab() {
  const access = useAccess();
  const { version, contents, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [switching, setSwitching] = useState<RatingEngineKind>();
  const [sampleId, setSampleId] = useState(GENERATED);

  const readOnly = version.status !== "draft" || !access.rating.write;
  const rating = contents.rating;
  const check = useRatingCheck(contents);
  const issues = check.data?.issues ?? [];
  const golden = check.data?.golden;
  const source = sourceOf(rating);
  const generated = useMemo(() => sampleInput(contents), [contents]);
  const sampleCase = rating?.goldenCases.find((c) => c.id === sampleId);
  const input = sampleCase?.input ?? generated;
  const preview = useRatingPreview(source, input);
  const section = search.section ?? "rater";

  const go = (next: RatingSearch) => navigate({ search: next, replace: true });
  const save = (next: RatingConfig) => set("rating", next);

  const start = (engine: RatingEngineKind) => {
    const currency = currencyOf(rating);
    const goldenCases = rating?.goldenCases ?? [];

    set(
      "rating",
      engine === "plan"
        ? { engine, plan: newPlan(version.version, currency), goldenCases }
        : engine === "extension"
          ? { engine, extensionVersionId: "", currency, goldenCases }
          : {
              engine,
              workbookId: null,
              manifest: newManifest(version.version, currency),
              goldenCases,
            },
      true,
    );
  };

  if (!rating) {
    return (
      <PageBody className="max-w-4xl">
        <Panel
          title="Choose how this version is rated"
          description="Every engine returns the same premiums, worksheet and golden case results."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(ENGINES) as RatingEngineKind[]).map((engine) => {
              const { label, description, icon: Icon } = ENGINES[engine];

              return (
                <button
                  key={engine}
                  type="button"
                  disabled={readOnly}
                  onClick={() => start(engine)}
                  className="flex items-start gap-3 rounded-lg border p-4 text-left outline-none transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4.5" />
                  </span>
                  <span className="grid gap-1">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-sm text-muted-foreground">{description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>
      </PageBody>
    );
  }

  const others = (Object.keys(ENGINES) as RatingEngineKind[]).filter((e) => e !== rating.engine);

  const sampleControl = (
    <Select value={sampleCase ? sampleId : GENERATED} onValueChange={setSampleId}>
      <SelectTrigger size="sm" className="w-52" aria-label="Sample">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={GENERATED} description="Every field filled from the risk data">
          Sample risk
        </SelectItem>
        {rating.goldenCases.length > 0 && <SelectSeparator />}
        {rating.goldenCases.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const worksheet = (focus: string | undefined) => (
    <Worksheet
      preview={preview.data}
      coverages={contents.coverages}
      schema={contents.riskSchema}
      focus={focus}
      sample={sampleControl}
      loading={preview.isFetching}
    />
  );

  const failing = golden?.failed ?? 0;

  return (
    <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Rating"
          value={section}
          onValueChange={(next) => go(next === "golden" ? { section: "golden" } : {})}
          options={[
            { value: "rater", label: ENGINES[rating.engine].label },
            {
              value: "golden",
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Golden cases
                  <span
                    className={cn(
                      "tabular-nums",
                      failing > 0 ? "text-red-700" : "text-muted-foreground",
                    )}
                  >
                    {failing > 0 ? `${failing} failing` : rating.goldenCases.length}
                  </span>
                </span>
              ),
            },
          ]}
        />
        {!readOnly && section === "rater" && (
          <div className="flex gap-1">
            {others.map((engine) => (
              <Button key={engine} size="sm" variant="ghost" onClick={() => setSwitching(engine)}>
                Switch to {ENGINES[engine].label.toLowerCase()}
              </Button>
            ))}
          </div>
        )}
      </div>

      {section === "golden" && source ? (
        <GoldenCases
          cases={rating.goldenCases}
          report={golden}
          source={source}
          contents={contents}
          sampleInput={generated}
          readOnly={readOnly}
          running={check.isFetching}
          selected={search.golden}
          onSelect={(id) => go({ section: "golden", ...(id && { golden: id }) })}
          onRun={() => void check.refetch()}
          onChange={(goldenCases) => set("rating", { ...rating, goldenCases }, true)}
        />
      ) : rating.engine === "plan" ? (
        <PlanEditor
          plan={rating.plan}
          schema={contents.riskSchema}
          coverages={contents.coverages}
          issues={issues}
          readOnly={readOnly}
          search={search}
          onNavigate={go}
          onChange={(plan) => save({ ...rating, plan })}
          worksheet={worksheet}
        />
      ) : rating.engine === "extension" ? (
        <ExtensionRaterEditor
          rating={rating}
          readOnly={readOnly}
          onChange={(next) =>
            set("rating", next, next.extensionVersionId !== rating.extensionVersionId)
          }
          worksheet={worksheet(undefined)}
        />
      ) : (
        <SpreadsheetEditor
          rating={rating}
          schema={contents.riskSchema}
          coverages={contents.coverages}
          issues={issues}
          readOnly={readOnly}
          onChange={(next) => set("rating", next, next.workbookId !== rating.workbookId)}
          worksheet={worksheet(undefined)}
        />
      )}

      <ConfirmDialog
        open={!!switching}
        onOpenChange={(open) => !open && setSwitching(undefined)}
        title={`Switch to ${switching ? ENGINES[switching].label.toLowerCase() : ""}?`}
        description={`The ${ENGINES[rating.engine].label.toLowerCase()} is removed from this version. Golden cases stay.`}
        confirmLabel="Switch engine"
        onConfirm={() => switching && start(switching)}
      />
    </PageBody>
  );
}
