import {
  type AddressValue,
  evaluateForm,
  type FieldNode,
  type FileValue,
  type FormDefinition,
  type FormItem,
  getAt,
  isField,
  type RiskSchema,
  schemaIndex,
} from "@pas/forms-core";
import { useExpressionsReady } from "@pas/forms-react";
import { Panel } from "@pas/ui/components/panel";
import { formatPlainDate } from "@/lib/format";

interface CapturedDataProps {
  schema: RiskSchema;
  form: FormDefinition;
  data: Record<string, unknown>;
}

/** Read-only view of risk data, laid out by the pinned form's steps and sections. */
export function CapturedData(props: CapturedDataProps) {
  const ready = useExpressionsReady();

  if (!ready) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;

  return <ReadyCapturedData {...props} />;
}

function ReadyCapturedData({ schema, form, data }: CapturedDataProps) {
  const state = evaluateForm(schema, form, data);
  const index = schemaIndex(schema);

  return form.steps.map((step, stepIndex) => {
    const stepState = state.steps[stepIndex];

    if (!stepState?.visible) return null;

    return (
      <Panel key={step.id} title={step.title} flush>
        <div className="divide-y">
          {step.sections.map((section, sectionIndex) => {
            const sectionState = stepState.sections[sectionIndex];

            if (!sectionState?.visible) return null;

            const field = (
              item: FormItem,
              i: number,
              entry: (typeof sectionState.entries)[number],
            ) => {
              const node = index.get(
                section.repeat ? `${section.repeat}[].${item.path}` : item.path,
              );

              const itemState = entry.items[i];

              if (!itemState?.visible || !isField(node)) return null;

              return (
                <div
                  key={item.path}
                  className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-4"
                >
                  <dt className="text-sm text-muted-foreground">{item.label ?? node.label}</dt>
                  <dd className="m-0 text-sm">
                    <Value field={node} value={getAt(data, itemState.path)} />
                  </dd>
                </div>
              );
            };

            const noun = section.itemLabel ?? section.title ?? section.repeat ?? "";

            return (
              <section key={section.id} className="grid gap-4 px-(--card-p) py-5">
                {section.title && (
                  <h3 className="m-0 text-sm leading-5 font-medium">{section.title}</h3>
                )}
                {section.repeat && sectionState.entries.length === 0 && (
                  <p className="m-0 text-sm text-muted-foreground">None added.</p>
                )}
                {sectionState.entries.map((entry) =>
                  section.repeat ? (
                    <div key={entry.index} className="grid gap-3 rounded-lg border p-4">
                      <p className="m-0 text-xs font-medium text-muted-foreground">
                        {noun} {entry.index! + 1}
                      </p>
                      <dl className="m-0 grid gap-3">
                        {section.items.map((item, i) => field(item, i, entry))}
                      </dl>
                    </div>
                  ) : (
                    <dl key="fields" className="m-0 grid gap-3">
                      {section.items.map((item, i) => field(item, i, entry))}
                    </dl>
                  ),
                )}
              </section>
            );
          })}
        </div>
      </Panel>
    );
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function Value({ field, value }: { field: FieldNode; value: unknown }) {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }

  const option = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? String(v);

  switch (field.kind) {
    case "boolean":
      return value === true ? "Yes" : "No";
    case "enum":
      return option(value);
    case "multi_enum":
      return Array.isArray(value) ? value.map(option).join(", ") : String(value);
    case "date":
      return <span className="tabular-nums">{formatPlainDate(String(value))}</span>;
    case "money":
      return (
        <span className="tabular-nums">
          {new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: field.currency ?? "USD",
          }).format(Number(value))}
        </span>
      );
    case "number":
    case "integer":
    case "percent":
      return (
        <span className="tabular-nums">
          {Number(value).toLocaleString(undefined, { useGrouping: field.kind !== "integer" })}
          {field.kind === "percent" && "%"}
        </span>
      );
    case "address":
      return isRecord(value) ? <Address value={value as Partial<AddressValue>} /> : String(value);
    case "file":
      return isRecord(value) ? (value as Partial<FileValue>).name : String(value);
    default:
      return String(value);
  }
}

function Address({ value }: { value: Partial<AddressValue> }) {
  const street = [value.line1, value.line2].filter(Boolean).join(", ");

  const locality = [value.city, [value.region, value.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  return (
    <span className="grid">
      <span>{street}</span>
      <span className="text-muted-foreground">{locality}</span>
    </span>
  );
}
