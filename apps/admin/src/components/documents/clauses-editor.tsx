import {
  type Clause,
  createResolver,
  type DocumentContext,
  parseRichText,
  resolveClause,
} from "@pas/documents";
import type { RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { Check, ChevronsUpDown, Plus, ScrollText, Trash2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  Code,
  IconAction,
  InspectorBody,
  InspectorHeader,
  InspectorSection,
  Prop,
} from "@/components/builders/inspector";
import { toKey, uniqueKey } from "@/components/catalog/documents";
import type { Contents } from "@/components/catalog/version-editor";
import { MergeFieldInput } from "./merge-field-input";
import { usePreviewContext } from "./preview";

const STATES = subdivisionsOf("US");

const stateName = (code: string) => STATES.find(([c]) => c === code)?.[1] ?? code;
const shortCode = (code: string) => code.split("-").at(-1) ?? code;

function variantSummary(clause: Clause): string {
  const codes = clause.variants.flatMap((variant) => variant.jurisdictions).map(shortCode);

  return codes.length === 0 ? "Default only" : `Default · ${codes.join(", ")}`;
}

export function ClausesEditor({
  contents,
  onChange,
  readOnly,
  selected,
  onSelect,
  productName,
  version,
}: {
  contents: Contents;
  onChange: (clauses: Clause[]) => void;
  readOnly: boolean;
  selected: string | undefined;
  onSelect: (key: string | undefined) => void;
  productName: string;
  version: string;
}) {
  const clauses = contents.documents.clauses;

  const index = Math.max(
    0,
    clauses.findIndex((clause) => clause.key === selected),
  );

  const clause = clauses[index];

  const add = () => {
    const key = uniqueKey(
      clauses.map((c) => c.key),
      "new_clause",
    );

    onChange([...clauses, { key, title: "New clause", body: "", variants: [] }]);
    onSelect(key);
  };

  const update = (next: Clause) => onChange(clauses.map((c, i) => (i === index ? next : c)));

  const addAction = !readOnly && (
    <Button size="sm" variant="ghost" onClick={add}>
      <Plus /> Add clause
    </Button>
  );

  if (!clause) {
    return (
      <Card>
        <EmptyState
          icon={<ScrollText />}
          title="No clauses yet"
          description="Reusable wording that templates place with a clause block, with state variants."
          action={
            !readOnly && (
              <Button size="sm" variant="outline" onClick={add}>
                <Plus /> Add clause
              </Button>
            )
          }
        />
      </Card>
    );
  }

  return (
    <Card className="grid overflow-hidden lg:min-h-[36rem] lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b bg-muted/30 lg:border-r lg:border-b-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-4">
          <span className="text-sm font-medium">
            Clauses <span className="text-muted-foreground tabular-nums">{clauses.length}</span>
          </span>
          {addAction}
        </div>
        <ul
          aria-label="Clauses"
          className="m-0 grid list-none grid-cols-[minmax(0,1fr)] content-start gap-px p-1.5"
        >
          {clauses.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                aria-current={i === index || undefined}
                onClick={() => onSelect(item.key)}
                className={cn(
                  "grid w-full gap-0.5 rounded-md px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                  i === index ? "bg-primary/[0.07]" : "hover:bg-muted/70",
                )}
              >
                <span className="truncate text-sm font-medium">
                  {item.title || "Untitled clause"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {variantSummary(item)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          <InspectorHeader
            icon={ScrollText}
            title={clause.title || "Untitled clause"}
            subtitle={<Code className="text-xs text-muted-foreground">{clause.key}</Code>}
            actions={
              !readOnly && (
                <IconAction
                  label="Delete clause"
                  icon={Trash2}
                  onClick={() => {
                    onChange(clauses.filter((_, i) => i !== index));
                    onSelect(undefined);
                  }}
                />
              )
            }
          />
          <ClauseFields
            key={clause.key}
            clause={clause}
            taken={clauses.filter((_, i) => i !== index).map((c) => c.key)}
            onChange={update}
            onRename={(key) => onSelect(key)}
            schema={contents.riskSchema}
            readOnly={readOnly}
          />
        </div>
        <ClausePreview
          clause={clause}
          contents={contents}
          productName={productName}
          version={version}
        />
      </div>
    </Card>
  );
}

function ClauseFields({
  clause,
  taken,
  onChange,
  onRename,
  schema,
  readOnly,
}: {
  clause: Clause;
  taken: string[];
  onChange: (clause: Clause) => void;
  onRename: (key: string) => void;
  schema: RiskSchema;
  readOnly: boolean;
}) {
  const id = useId();
  const claimed = new Set(clause.variants.flatMap((variant) => variant.jurisdictions));

  const setVariant = (i: number, patch: Partial<Clause["variants"][number]>) =>
    onChange({
      ...clause,
      variants: clause.variants.map((variant, j) => (j === i ? { ...variant, ...patch } : variant)),
    });

  if (readOnly) {
    return (
      <InspectorBody>
        <InspectorSection title="Default wording" readOnly>
          <Prop readOnly label="Title" value={clause.title} />
          <Prop
            readOnly
            label="Wording"
            value={<span className="whitespace-pre-line">{clause.body}</span>}
          />
        </InspectorSection>
        {clause.variants.map((variant, i) => (
          <InspectorSection
            key={i}
            title={variant.jurisdictions.map(stateName).join(", ") || `Variant ${i + 1}`}
            readOnly
          >
            <Prop readOnly label="Title" value={variant.title} />
            <Prop
              readOnly
              label="Wording"
              value={<span className="whitespace-pre-line">{variant.body}</span>}
            />
          </InspectorSection>
        ))}
      </InspectorBody>
    );
  }

  return (
    <InspectorBody>
      <InspectorSection title="Default wording">
        <Prop label="Title" htmlFor={`${id}-title`}>
          <Input
            id={`${id}-title`}
            value={clause.title}
            onChange={(event) => {
              const title = event.target.value;
              const fresh = clause.key.startsWith("new_clause");
              const key = fresh ? uniqueKey(taken, toKey(title)) : clause.key;
              onChange({ ...clause, title, key });

              if (key !== clause.key) onRename(key);
            }}
          />
        </Prop>
        <Prop label="Wording" htmlFor={`${id}-body`} hint="Used wherever no state variant applies.">
          <MergeFieldInput
            id={`${id}-body`}
            value={clause.body}
            onChange={(body) => onChange({ ...clause, body })}
            schema={schema}
            multiline
            rows={6}
          />
        </Prop>
      </InspectorSection>
      <InspectorSection
        title="State variants"
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onChange({
                ...clause,
                variants: [...clause.variants, { jurisdictions: [], body: clause.body }],
              })
            }
          >
            <Plus /> Add variant
          </Button>
        }
      >
        {clause.variants.length === 0 && (
          <p className="m-0 text-sm text-muted-foreground">
            Add a variant where a state requires different wording.
          </p>
        )}
        {clause.variants.map((variant, i) => (
          <div key={i} className="grid gap-4 rounded-lg border p-4">
            <div className="flex items-start gap-2">
              <Prop label="Applies in" className="flex-1">
                <StatePicker
                  value={variant.jurisdictions}
                  claimed={claimed}
                  onChange={(jurisdictions) => setVariant(i, { jurisdictions })}
                />
              </Prop>
              <IconAction
                label={`Remove variant ${i + 1}`}
                icon={X}
                className="mt-6"
                onClick={() =>
                  onChange({ ...clause, variants: clause.variants.filter((_, j) => j !== i) })
                }
              />
            </div>
            <Prop label="Title" optional htmlFor={`${id}-v${i}-title`}>
              <Input
                id={`${id}-v${i}-title`}
                value={variant.title ?? ""}
                placeholder={clause.title}
                onChange={(event) => setVariant(i, { title: event.target.value || undefined })}
              />
            </Prop>
            <Prop label="Wording" htmlFor={`${id}-v${i}-body`}>
              <MergeFieldInput
                id={`${id}-v${i}-body`}
                value={variant.body}
                onChange={(body) => setVariant(i, { body })}
                schema={schema}
                multiline
                rows={6}
              />
            </Prop>
          </div>
        ))}
      </InspectorSection>
    </InspectorBody>
  );
}

function StatePicker({
  value,
  claimed,
  onChange,
}: {
  value: string[];
  claimed: ReadonlySet<string>;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal",
            value.length === 0 && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 flex-wrap gap-1">
            {value.length === 0
              ? "Choose states"
              : value.map((code) => (
                  <span
                    key={code}
                    className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {stateName(code)}
                  </span>
                ))}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search states" className="h-10" />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No states match.</CommandEmpty>
            <CommandGroup>
              {STATES.map(([code, name]) => {
                const taken = claimed.has(code) && !selected.has(code);

                return (
                  <CommandItem
                    key={code}
                    value={`${name} ${shortCode(code)}`}
                    disabled={taken}
                    onSelect={() =>
                      onChange(
                        selected.has(code)
                          ? value.filter((c) => c !== code)
                          : [...value, code].toSorted(),
                      )
                    }
                  >
                    <span className="truncate">{name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {taken ? "Has a variant" : shortCode(code)}
                    </span>
                    <Check
                      className={cn("size-4", selected.has(code) ? "text-primary!" : "invisible")}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const DEFAULT = "default";

function ClausePreview({
  clause,
  contents,
  productName,
  version,
}: {
  clause: Clause;
  contents: Contents;
  productName: string;
  version: string;
}) {
  const codes = [...new Set(clause.variants.flatMap((variant) => variant.jurisdictions))];
  const [choice, setChoice] = useState<string>(codes[0] ?? DEFAULT);
  const code = choice === DEFAULT || codes.includes(choice) ? choice : DEFAULT;

  const jurisdiction = useMemo(
    () =>
      code === DEFAULT ? { country: "US" } : { country: code.split("-")[0]!, subdivision: code },
    [code],
  );

  const scenario = useMemo(
    () => ({ jurisdiction, transaction: "new_business" as const }),
    [jurisdiction],
  );

  const preview = usePreviewContext(contents, productName, version, scenario);

  return (
    <div className="flex min-w-0 flex-col border-t bg-muted/40 xl:border-t-0 xl:border-l">
      <div className="flex h-[4.5rem] shrink-0 items-center justify-between gap-3 border-b bg-card px-4">
        <span className="text-sm font-medium">Preview</span>
        <Select value={code} onValueChange={setChoice}>
          <SelectTrigger size="sm" aria-label="Preview as" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={DEFAULT}>Other states</SelectItem>
            {codes.map((c) => (
              <SelectItem key={c} value={c}>
                {stateName(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="p-5">
        {preview && (
          <Wording clause={clause} context={preview.context} schema={contents.riskSchema} />
        )}
      </div>
    </div>
  );
}

function Wording({
  clause,
  context,
  schema,
}: {
  clause: Clause;
  context: DocumentContext;
  schema: RiskSchema;
}) {
  const resolver = createResolver(context, schema);
  const resolved = resolveClause(clause, context.policy.jurisdiction);

  return (
    <article className="grid gap-2.5 rounded-lg bg-card p-5 text-[0.8125rem] leading-[1.6] text-foreground/85 shadow-(--card-shadow) ring-1 ring-black/5">
      <h3 className="m-0 text-sm font-semibold text-foreground">
        {resolver.merge(resolved.title)}
      </h3>
      {parseRichText(resolver.merge(resolved.body)).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i} className="m-0">
            {block.runs.map((run, j) =>
              run.bold ? (
                <strong key={j} className="font-semibold text-foreground">
                  {run.text}
                </strong>
              ) : (
                run.text
              ),
            )}
          </p>
        ) : (
          <ul key={i} className="m-0 grid gap-1 pl-4">
            {block.items.map((item, j) => (
              <li key={j}>{item.map((run) => run.text).join("")}</li>
            ))}
          </ul>
        ),
      )}
      <p className="m-0 mt-1 text-xs text-muted-foreground">
        {resolved.variant === null ? "Default wording" : "State variant"}
      </p>
    </article>
  );
}
