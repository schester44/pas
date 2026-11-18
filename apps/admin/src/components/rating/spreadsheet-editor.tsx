import { indexSchema, type RiskSchema } from "@pas/forms-core";
import type {
  BindingManifest,
  CellTarget,
  InputBinding,
  OutputBinding,
  Transform,
} from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Plus, Upload, X } from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import type { Coverage, RatingConfig } from "@/components/catalog/version-editor";
import { humanize } from "@/components/decisions/jdm-edit";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { operandOptions } from "./model";
import { OperandPicker } from "./operand-picker";
import type { RaterWorkbookDetail, RatingIssue } from "./use-rating";
import { formatSize, UploadWorkbookDialog, WorkbookReport } from "./workbook-report";
import { readable } from "@/lib/readable";

type SpreadsheetConfig = Extract<RatingConfig, { engine: "spreadsheet" }>;

const TRANSFORMS = {
  none: "As is",
  number: "Number",
  boolean: "Yes / no",
  map: "Map values",
  excelDate: "Excel date",
} as const;

type TransformKind = keyof typeof TRANSFORMS;

const targetValue = (target: CellTarget) =>
  "cell" in target ? `cell:${target.cell}` : `name:${target.name}`;

const targetFrom = (value: string): CellTarget =>
  value.startsWith("name:") ? { name: value.slice(5) } : { cell: value.slice(5) };

interface CellOption {
  value: string;
  label: string;
  detail: string;
}

function cellOptions(detail: RaterWorkbookDetail | undefined, formulas: boolean) {
  if (!detail) return { names: [] as CellOption[], sheets: [] as [string, CellOption[]][] };

  const names = detail.names.map((n) => ({
    value: `name:${n.name}`,
    label: n.name,
    detail: n.ref,
  }));

  const sheets = detail.sheets.map((sheet): [string, CellOption[]] => {
    const byAddress = new Map(sheet.cells.map((cell) => [cell.address, cell]));

    const cells = sheet.cells
      .filter((cell) => !!cell.formula === formulas && (formulas || typeof cell.value !== "string"))
      .map((cell) => {
        const row = /\d+$/.exec(cell.address)?.[0];
        const caption = row ? byAddress.get(`A${row}`)?.value : undefined;

        return {
          value: `cell:${sheet.name}!${cell.address}`,
          label: `${sheet.name}!${cell.address}`,
          detail: typeof caption === "string" && !cell.address.startsWith("A") ? caption : "",
        };
      });

    return [sheet.name, cells];
  });

  return { names, sheets: sheets.filter(([, cells]) => cells.length > 0) };
}

function TargetSelect({
  value,
  detail,
  formulas,
  disabled,
  label,
  onChange,
}: {
  value: CellTarget | undefined;
  detail: RaterWorkbookDetail | undefined;
  formulas: boolean;
  disabled: boolean;
  label: string;
  onChange: (target: CellTarget) => void;
}) {
  const { names, sheets } = useMemo(() => cellOptions(detail, formulas), [detail, formulas]);

  return (
    <Select
      value={value ? targetValue(value) : ""}
      disabled={disabled}
      onValueChange={(next) => onChange(targetFrom(next))}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue placeholder="Choose a cell" />
      </SelectTrigger>
      <SelectContent>
        {names.length > 0 && (
          <SelectGroup>
            <SelectLabel>Named ranges</SelectLabel>
            {names.map((option) => (
              <SelectItem key={option.value} value={option.value} description={option.detail}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {sheets.map(([sheet, cells]) => (
          <SelectGroup key={sheet}>
            <SelectLabel>{sheet}</SelectLabel>
            {cells.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                {...(option.detail && { description: option.detail })}
              >
                <span className="font-mono text-[0.8125rem]">{option.label}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SpreadsheetEditor({
  rating,
  schema,
  coverages,
  issues,
  readOnly,
  onChange,
  worksheet,
}: {
  rating: SpreadsheetConfig;
  schema: RiskSchema;
  coverages: readonly Coverage[];
  issues: RatingIssue[];
  readOnly: boolean;
  onChange: (rating: SpreadsheetConfig) => void;
  worksheet: React.ReactNode;
}) {
  const trpc = useTRPC();
  const [uploading, setUploading] = useState(false);
  const workbooks = useQuery(trpc.rating.workbooks.list.queryOptions());

  const detail = useQuery({
    ...trpc.rating.workbooks.get.queryOptions({ id: rating.workbookId ?? "" }),
    enabled: !!rating.workbookId,
  });

  const workbook = workbooks.data?.find((w) => w.id === rating.workbookId);
  const manifest = rating.manifest;
  const setManifest = (next: BindingManifest) => onChange({ ...rating, manifest: next });
  const workbookIssues = issues.filter((issue) => issue.target.section === "workbook");
  const manifestIssues = issues.filter((issue) => issue.target.section === "manifest");

  const chooser = workbooks.data && workbooks.data.length > 0 && !readOnly && (
    <Select
      value={rating.workbookId ?? ""}
      onValueChange={(workbookId) => onChange({ ...rating, workbookId })}
    >
      <SelectTrigger size="sm" className="w-56" aria-label="Workbook">
        <SelectValue placeholder="Choose a workbook" />
      </SelectTrigger>
      <SelectContent align="end">
        {workbooks.data.map((w) => (
          <SelectItem
            key={w.id}
            value={w.id}
            description={`${w.fileName} · ${formatDate(w.createdAt)}`}
          >
            {w.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const uploadAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
      <Upload /> Upload workbook
    </Button>
  );

  return (
    <div className="grid min-w-0 gap-6">
      {workbook ? (
        <Panel
          title={workbook.name}
          description={
            <span className="tabular-nums">
              {workbook.fileName} · {formatSize(workbook.sizeBytes)} · uploaded{" "}
              {formatDate(workbook.createdAt)} ·{" "}
              <code className="font-mono text-xs">{workbook.sha256.slice(0, 12)}</code>
            </span>
          }
          action={
            <div className="flex items-center gap-2">
              {chooser}
              {uploadAction}
            </div>
          }
        >
          <WorkbookReport report={workbook.report} />
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon={<FileSpreadsheet />}
            title={rating.workbookId ? "Loading workbook" : "No workbook yet"}
            description={
              workbookIssues[0]?.message ??
              "Upload the actuary's .xlsx rater, then bind risk data to its input cells."
            }
            action={
              <div className="flex items-center gap-2">
                {chooser}
                {uploadAction}
              </div>
            }
          />
        </Panel>
      )}

      {rating.workbookId && (
        <ManifestEditor
          manifest={manifest}
          schema={schema}
          coverages={coverages}
          detail={detail.data}
          issues={manifestIssues}
          readOnly={readOnly}
          onChange={setManifest}
        />
      )}

      {rating.workbookId && worksheet}

      <UploadWorkbookDialog
        open={uploading}
        onOpenChange={setUploading}
        onUploaded={(uploaded) => onChange({ ...rating, workbookId: uploaded.id })}
      />
    </div>
  );
}

function exposuresOf(schema: RiskSchema) {
  return [...indexSchema(schema).values()]
    .filter((node) => node.kind === "repeatable" && node.exposure)
    .map((node) => ({
      value: `${node.path}[]`,
      label: `Each ${"exposure" in node && node.exposure ? node.exposure : node.label}`,
    }));
}

const transformKind = (transform: Transform | undefined): TransformKind =>
  transform?.kind ?? "none";

function newTransform(kind: TransformKind): Transform | undefined {
  switch (kind) {
    case "none":
      return undefined;
    case "number":
      return { kind: "number" };
    case "excelDate":
      return { kind: "excelDate" };
    case "boolean":
      return { kind: "boolean", true: 1, false: 0 };
    case "map":
      return { kind: "map", map: {} };
  }
}

function ManifestEditor({
  manifest,
  schema,
  coverages,
  detail,
  issues,
  readOnly,
  onChange,
}: {
  manifest: BindingManifest;
  schema: RiskSchema;
  coverages: readonly Coverage[];
  detail: RaterWorkbookDetail | undefined;
  issues: RatingIssue[];
  readOnly: boolean;
  onChange: (manifest: BindingManifest) => void;
}) {
  const id = useId();
  const exposures = useMemo(() => exposuresOf(schema), [schema]);

  const options = useMemo(
    () =>
      operandOptions(
        schema,
        coverages,
        manifest.exposure
          ? { coverage: "", exposure: manifest.exposure, steps: [], premium: "" }
          : undefined,
        [],
      ).filter((option) => "path" in option.operand),
    [schema, coverages, manifest.exposure],
  );

  const index = useMemo(() => indexSchema(schema), [schema]);

  const issuesAt = (property: string) =>
    issues.filter((issue) => issue.target.property === property);

  const general = issues.filter(
    (issue) => !/^(inputs|outputs)\[\d+\]$/.test(issue.target.property ?? ""),
  );

  const setInput = (i: number, binding: InputBinding) =>
    onChange({ ...manifest, inputs: manifest.inputs.map((b, j) => (j === i ? binding : b)) });

  const setOutput = (i: number, binding: OutputBinding) =>
    onChange({ ...manifest, outputs: manifest.outputs.map((b, j) => (j === i ? binding : b)) });

  const enumOptions = (path: string) => {
    const exposure = manifest.exposure?.replace(/\[\]$/, "");

    const schemaPath = path.startsWith("exposure.")
      ? `${exposure}[].${path.slice(9)}`
      : path.replace(/^risk\./, "");

    const node = index.get(schemaPath);

    return node && "options" in node ? (node.options ?? []) : [];
  };

  return (
    <Panel
      flush
      title="Bindings"
      description="Which risk data fills which input cell, and which cells hold each coverage's premium."
    >
      {general.length > 0 && (
        <ul className="m-0 grid list-none divide-y border-b p-0">
          {general.map((issue, i) => (
            <li key={i} className="flex items-center gap-2 px-(--card-p) py-2.5 text-sm">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500" />
              {readable(issue.message, coverages)}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 border-b px-(--card-p) py-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-exposure`}>Runs</Label>
          <Select
            value={manifest.exposure ?? "policy"}
            disabled={readOnly}
            onValueChange={(value) => {
              const { exposure: _, ...rest } = manifest;

              onChange(value === "policy" ? rest : { ...rest, exposure: value });
            }}
          >
            <SelectTrigger id={`${id}-exposure`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="policy">Once per policy</SelectItem>
              {exposures.map((exposure) => (
                <SelectItem key={exposure.value} value={exposure.value}>
                  {exposure.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-currency`}>Currency</Label>
          <Input
            id={`${id}-currency`}
            value={manifest.currency}
            maxLength={3}
            readOnly={readOnly}
            className="uppercase"
            onChange={(event) =>
              onChange({ ...manifest, currency: event.target.value.toUpperCase() })
            }
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-places`}>Round premiums to</Label>
          <Select
            value={String(manifest.rounding.places)}
            disabled={readOnly}
            onValueChange={(places) =>
              onChange({ ...manifest, rounding: { ...manifest.rounding, places: Number(places) } })
            }
          >
            <SelectTrigger id={`${id}-places`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Whole units</SelectItem>
              <SelectItem value="2">Cents</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <BindingTable
        title="Inputs"
        columns={["Risk data", "Cell", "Transform"]}
        empty="No inputs bound yet."
        addLabel="Add input"
        readOnly={readOnly}
        onAdd={() =>
          onChange({
            ...manifest,
            inputs: [...manifest.inputs, { path: "", target: { cell: "" } }],
          })
        }
      >
        {manifest.inputs.map((binding, i) => {
          const kind = transformKind(binding.transform);
          const problems = issuesAt(`inputs[${i}]`);

          return (
            <BindingRow
              key={i}
              problems={problems.map((p) => readable(p.message, coverages))}
              readOnly={readOnly}
              onRemove={() =>
                onChange({ ...manifest, inputs: manifest.inputs.filter((_, j) => j !== i) })
              }
              cells={[
                <OperandPicker
                  key="path"
                  value={binding.path ? { path: binding.path } : undefined}
                  options={options}
                  disabled={readOnly}
                  placeholder="Choose a field"
                  onChange={(operand) =>
                    "path" in operand && setInput(i, { ...binding, path: operand.path })
                  }
                />,
                <TargetSelect
                  key="target"
                  label={`Input ${i + 1} cell`}
                  value={
                    "cell" in binding.target && !binding.target.cell ? undefined : binding.target
                  }
                  detail={detail}
                  formulas={false}
                  disabled={readOnly}
                  onChange={(target) => setInput(i, { ...binding, target })}
                />,
                <div key="transform" className="grid gap-2">
                  <Select
                    value={kind}
                    disabled={readOnly}
                    onValueChange={(next) => {
                      const { transform: _, ...rest } = binding;
                      const transform = newTransform(next as TransformKind);

                      setInput(i, transform ? { ...rest, transform } : rest);
                    }}
                  >
                    <SelectTrigger aria-label={`Input ${i + 1} transform`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TRANSFORMS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {binding.transform?.kind === "map" && (
                    <MapEditor
                      transform={binding.transform}
                      options={enumOptions(binding.path)}
                      readOnly={readOnly}
                      onChange={(transform) => setInput(i, { ...binding, transform })}
                    />
                  )}
                  {binding.transform?.kind === "boolean" && (
                    <div className="grid grid-cols-2 gap-2">
                      {(["true", "false"] as const).map((side) => (
                        <label key={side} className="grid gap-1 text-xs text-muted-foreground">
                          {side === "true" ? "Yes" : "No"}
                          <Input
                            className="h-8"
                            readOnly={readOnly}
                            value={String(
                              (binding.transform as Extract<Transform, { kind: "boolean" }>)[side],
                            )}
                            onChange={(event) =>
                              setInput(i, {
                                ...binding,
                                transform: {
                                  ...(binding.transform as Extract<Transform, { kind: "boolean" }>),
                                  [side]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>,
              ]}
            />
          );
        })}
      </BindingTable>

      <BindingTable
        title="Outputs"
        columns={["Cell", "Result", "Coverage"]}
        empty="No outputs bound yet."
        addLabel="Add output"
        readOnly={readOnly}
        onAdd={() =>
          onChange({
            ...manifest,
            outputs: [
              ...manifest.outputs,
              { source: { cell: "" }, kind: "premium", coverage: coverages[0]?.code ?? "" },
            ],
          })
        }
      >
        {manifest.outputs.map((binding, i) => (
          <BindingRow
            key={i}
            problems={issuesAt(`outputs[${i}]`).map((p) => readable(p.message, coverages))}
            readOnly={readOnly}
            onRemove={() =>
              onChange({ ...manifest, outputs: manifest.outputs.filter((_, j) => j !== i) })
            }
            cells={[
              <TargetSelect
                key="source"
                label={`Output ${i + 1} cell`}
                value={
                  "cell" in binding.source && !binding.source.cell ? undefined : binding.source
                }
                detail={detail}
                formulas
                disabled={readOnly}
                onChange={(source) => setOutput(i, { ...binding, source })}
              />,
              <Select
                key="kind"
                value={binding.kind}
                disabled={readOnly}
                onValueChange={(kind) =>
                  setOutput(
                    i,
                    kind === "premium"
                      ? {
                          source: binding.source,
                          kind: "premium",
                          coverage: binding.coverage ?? coverages[0]?.code ?? "",
                        }
                      : { source: binding.source, kind: "factor", name: "factor" },
                  )
                }
              >
                <SelectTrigger aria-label={`Output ${i + 1} result`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="factor">Factor</SelectItem>
                </SelectContent>
              </Select>,
              binding.kind === "premium" ? (
                <Select
                  key="coverage"
                  value={binding.coverage}
                  disabled={readOnly}
                  onValueChange={(coverage) => setOutput(i, { ...binding, coverage })}
                >
                  <SelectTrigger aria-label={`Output ${i + 1} coverage`} className="w-full">
                    <SelectValue placeholder="Choose a coverage" />
                  </SelectTrigger>
                  <SelectContent>
                    {coverages.map((coverage) => (
                      <SelectItem key={coverage.code} value={coverage.code}>
                        {coverage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  key="name"
                  aria-label={`Output ${i + 1} factor name`}
                  value={binding.name}
                  readOnly={readOnly}
                  className="font-mono"
                  onChange={(event) => setOutput(i, { ...binding, name: event.target.value })}
                />
              ),
            ]}
          />
        ))}
      </BindingTable>
    </Panel>
  );
}

function MapEditor({
  transform,
  options,
  readOnly,
  onChange,
}: {
  transform: Extract<Transform, { kind: "map" }>;
  options: { value: string; label: string }[];
  readOnly: boolean;
  onChange: (transform: Extract<Transform, { kind: "map" }>) => void;
}) {
  const keys = options.length ? options.map((o) => o.value) : Object.keys(transform.map);

  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/30 p-2">
      {keys.map((key) => (
        <label key={key} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {options.find((o) => o.value === key)?.label ?? humanize(key)}
          </span>
          <Input
            className="h-7 w-20 font-mono text-xs"
            readOnly={readOnly}
            value={String(transform.map[key] ?? "")}
            onChange={(event) =>
              onChange({ ...transform, map: { ...transform.map, [key]: event.target.value } })
            }
          />
        </label>
      ))}
      {keys.length === 0 && (
        <p className="m-0 text-xs text-muted-foreground">Choose an enum field to map its values.</p>
      )}
    </div>
  );
}

function BindingTable({
  title,
  columns,
  empty,
  addLabel,
  readOnly,
  onAdd,
  children,
}: {
  title: string;
  columns: string[];
  empty: string;
  addLabel: string;
  readOnly: boolean;
  onAdd: () => void;
  children: React.ReactNode[];
}) {
  return (
    <section className="border-b last:border-b-0">
      <header className="flex items-center justify-between px-(--card-p) pt-4 pb-2">
        <h3 className="m-0 text-sm font-medium">{title}</h3>
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={onAdd}>
            <Plus /> {addLabel}
          </Button>
        )}
      </header>
      {children.length === 0 ? (
        <p className="m-0 px-(--card-p) pb-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid pb-2">
          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-3 px-(--card-p) pb-1.5 text-xs font-medium text-muted-foreground">
            {columns.map((column) => (
              <span key={column}>{column}</span>
            ))}
          </div>
          {children}
        </div>
      )}
    </section>
  );
}

function BindingRow({
  cells,
  problems,
  readOnly,
  onRemove,
}: {
  cells: React.ReactNode[];
  problems: string[];
  readOnly: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-1 px-(--card-p) py-1.5">
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_2rem] items-start gap-3">
        {cells}
        {!readOnly && (
          <Button
            size="icon"
            variant="ghost"
            className="size-9 text-muted-foreground"
            aria-label="Remove binding"
            onClick={onRemove}
          >
            <X />
          </Button>
        )}
      </div>
      {problems.map((problem) => (
        <p key={problem} className="m-0 text-sm text-red-700">
          {problem}
        </p>
      ))}
    </div>
  );
}
