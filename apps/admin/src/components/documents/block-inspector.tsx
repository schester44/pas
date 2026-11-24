import { type Block, type Clause, contextSchema } from "@pas/documents";
import { indexSchema, isField, type RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Plus, X } from "lucide-react";
import { useId, useMemo } from "react";
import { ExpressionInput, ExpressionView } from "@/components/builders/expression-input";
import { fieldFor, rootRepeatables } from "@/components/builders/form-tree";
import {
  Code,
  FlagProp,
  IconAction,
  InspectorBody,
  InspectorSection,
  Prop,
  PropRow,
} from "@/components/builders/inspector";
import { PathPicker } from "@/components/builders/path-picker";
import { useDocumentFields } from "./document-fields";
import { MergeFieldInput } from "./merge-field-input";

interface Props<B extends Block = Block> {
  block: B;
  onChange: (block: B) => void;
  schema: RiskSchema;
  clauses: readonly Clause[];
  readOnly: boolean;
}

function TextProp({
  label,
  value,
  onChange,
  readOnly,
  schema,
  optional,
  multiline,
  merge = true,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly: boolean;
  schema: RiskSchema;
  optional?: boolean;
  multiline?: boolean;
  merge?: boolean;
  hint?: string;
}) {
  const id = useId();

  if (readOnly) {
    return (
      <Prop
        readOnly
        label={label}
        value={value ? <span className="whitespace-pre-line">{value}</span> : undefined}
      />
    );
  }

  return (
    <Prop label={label} htmlFor={id} optional={optional} hint={hint}>
      {merge ? (
        <MergeFieldInput
          id={id}
          value={value ?? ""}
          onChange={onChange}
          schema={schema}
          multiline={multiline}
          rows={multiline ? 6 : undefined}
        />
      ) : (
        <Input id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />
      )}
    </Prop>
  );
}

const optional = (value: string) => (value.trim() ? value : undefined);

function KeyValueFields({
  block,
  onChange,
  schema,
  readOnly,
}: Props<Extract<Block, { type: "keyValue" }>>) {
  const rows = block.rows;

  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
    onChange({ ...block, rows: rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) });

  return (
    <>
      <InspectorSection title="Details" readOnly={readOnly}>
        <TextProp
          label="Title"
          optional
          merge={false}
          value={block.title}
          onChange={(title) => onChange({ ...block, title: optional(title) })}
          readOnly={readOnly}
          schema={schema}
        />
        {readOnly ? (
          <Prop
            readOnly
            label="Layout"
            value={block.columns === 2 ? "Two columns" : "One column"}
          />
        ) : (
          <Prop label="Layout">
            <SegmentedControl
              label="Layout"
              value={String(block.columns) as "1" | "2"}
              onValueChange={(next) => onChange({ ...block, columns: next === "2" ? 2 : 1 })}
              options={[
                { value: "1", label: "One column" },
                { value: "2", label: "Two columns" },
              ]}
            />
          </Prop>
        )}
      </InspectorSection>
      <InspectorSection
        title="Rows"
        readOnly={readOnly}
        action={
          !readOnly && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...block, rows: [...rows, { label: "", value: "" }] })}
            >
              <Plus /> Add row
            </Button>
          )
        }
      >
        {readOnly
          ? rows.map((row, i) => (
              <Prop key={i} readOnly label={row.label} value={<Code>{row.value}</Code>} />
            ))
          : rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[10rem_minmax(0,1fr)_2rem] items-start gap-2">
                <Input
                  aria-label={`Row ${i + 1} label`}
                  placeholder="Label"
                  value={row.label}
                  onChange={(event) => setRow(i, { label: event.target.value })}
                />
                <MergeFieldInput
                  value={row.value}
                  placeholder="{{namedInsured.name}}"
                  onChange={(value) => setRow(i, { value })}
                  schema={schema}
                />
                <IconAction
                  label={`Remove row ${i + 1}`}
                  icon={X}
                  onClick={() => onChange({ ...block, rows: rows.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
      </InspectorSection>
    </>
  );
}

function ExposureFields({
  block,
  onChange,
  schema,
  readOnly,
}: Props<Extract<Block, { type: "exposureTable" }>>) {
  const id = useId();
  const repeatables = useMemo(() => rootRepeatables(schema), [schema]);
  const bound = new Set(block.columns.map((column) => column.path));

  const setColumn = (i: number, patch: Partial<(typeof block.columns)[number]>) =>
    onChange({
      ...block,
      columns: block.columns.map((column, j) => (j === i ? { ...column, ...patch } : column)),
    });

  return (
    <>
      <InspectorSection title="Content" readOnly={readOnly}>
        <TextProp
          label="Title"
          optional
          merge={false}
          value={block.title}
          onChange={(title) => onChange({ ...block, title: optional(title) })}
          readOnly={readOnly}
          schema={schema}
        />
        {readOnly ? (
          <Prop readOnly label="Rows from" value={<Code>{block.path}</Code>} />
        ) : (
          <Prop label="Rows from" htmlFor={id} hint="One row per entry.">
            <Select
              value={block.path || undefined}
              onValueChange={(path) => onChange({ ...block, path, columns: [] })}
            >
              <SelectTrigger id={id}>
                <SelectValue placeholder="Choose a repeatable" />
              </SelectTrigger>
              <SelectContent>
                {repeatables.map((node) => (
                  <SelectItem key={node.path} value={node.path}>
                    {node.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Prop>
        )}
      </InspectorSection>
      {block.path && (
        <InspectorSection
          title="Columns"
          readOnly={readOnly}
          action={
            !readOnly && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({ ...block, columns: [...block.columns, { label: "", path: "" }] })
                }
              >
                <Plus /> Add column
              </Button>
            )
          }
        >
          {readOnly
            ? block.columns.map((column, i) => (
                <Prop key={i} readOnly label={column.label} value={<Code>{column.path}</Code>} />
              ))
            : block.columns.map((column, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[10rem_minmax(0,1fr)_2rem] items-start gap-2"
                >
                  <Input
                    aria-label={`Column ${i + 1} label`}
                    placeholder="Label"
                    value={column.label}
                    onChange={(event) => setColumn(i, { label: event.target.value })}
                  />
                  <PathPicker
                    schema={schema}
                    repeat={block.path}
                    value={column.path}
                    bound={bound}
                    onChange={(path) =>
                      setColumn(i, {
                        path,
                        label: column.label || (fieldFor(schema, path, block.path)?.label ?? ""),
                      })
                    }
                  />
                  <IconAction
                    label={`Remove column ${i + 1}`}
                    icon={X}
                    onClick={() =>
                      onChange({ ...block, columns: block.columns.filter((_, j) => j !== i) })
                    }
                  />
                </div>
              ))}
        </InspectorSection>
      )}
    </>
  );
}

function DataTableFields({
  block,
  onChange,
  schema,
  readOnly,
}: Props<Extract<Block, { type: "dataTable" }>>) {
  const id = useId();
  const extra = useDocumentFields();

  const index = useMemo(
    () => indexSchema(contextSchema(schema, "document", extra)),
    [schema, extra],
  );

  const lists = useMemo(
    () =>
      [...index].filter(
        ([path, node]) =>
          node.kind === "repeatable" && !path.includes("[]") && !path.startsWith("risk."),
      ),
    [index],
  );

  const list = index.get(block.path);
  const columns = list?.kind === "repeatable" ? list.children.filter(isField) : [];
  const parent = block.path.slice(0, block.path.lastIndexOf("."));

  const totals = [...index].filter(
    ([path, node]) =>
      isField(node) &&
      path.startsWith(`${parent}.`) &&
      !path.slice(parent.length + 1).includes("."),
  );

  const setColumn = (i: number, patch: Partial<(typeof block.columns)[number]>) =>
    onChange({
      ...block,
      columns: block.columns.map((column, j) => (j === i ? { ...column, ...patch } : column)),
    });

  const labelOf = (path: string) => index.get(path)?.label ?? path;

  return (
    <>
      <InspectorSection title="Content" readOnly={readOnly}>
        <TextProp
          label="Title"
          optional
          merge={false}
          value={block.title}
          onChange={(title) => onChange({ ...block, title: optional(title) })}
          readOnly={readOnly}
          schema={schema}
        />
        {readOnly ? (
          <Prop readOnly label="Rows from" value={labelOf(block.path)} />
        ) : (
          <Prop label="Rows from" htmlFor={id} hint="One row per entry.">
            <Select
              value={block.path || undefined}
              onValueChange={(path) => onChange({ ...block, path, columns: [] })}
            >
              <SelectTrigger id={id}>
                <SelectValue placeholder="Choose a list" />
              </SelectTrigger>
              <SelectContent>
                {lists.map(([path, node]) => (
                  <SelectItem key={path} value={path}>
                    {labelOf(path.slice(0, path.lastIndexOf(".")))} · {node.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Prop>
        )}
      </InspectorSection>
      {block.path && (
        <InspectorSection
          title="Columns"
          readOnly={readOnly}
          action={
            !readOnly && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({ ...block, columns: [...block.columns, { label: "", path: "" }] })
                }
              >
                <Plus /> Add column
              </Button>
            )
          }
        >
          {block.columns.map((column, i) =>
            readOnly ? (
              <Prop key={i} readOnly label={column.label} value={<Code>{column.path}</Code>} />
            ) : (
              <div key={i} className="grid grid-cols-[10rem_minmax(0,1fr)_2rem] items-start gap-2">
                <Input
                  aria-label={`Column ${i + 1} label`}
                  placeholder="Label"
                  value={column.label}
                  onChange={(event) => setColumn(i, { label: event.target.value })}
                />
                <Select
                  value={column.path || undefined}
                  onValueChange={(path) =>
                    setColumn(i, {
                      path,
                      label: column.label || (columns.find((c) => c.key === path)?.label ?? ""),
                    })
                  }
                >
                  <SelectTrigger aria-label={`Column ${i + 1} field`}>
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <IconAction
                  label={`Remove column ${i + 1}`}
                  icon={X}
                  onClick={() =>
                    onChange({ ...block, columns: block.columns.filter((_, j) => j !== i) })
                  }
                />
              </div>
            ),
          )}
        </InspectorSection>
      )}
      {block.path && (
        <InspectorSection title="Rows and total" readOnly={readOnly}>
          {readOnly ? (
            <>
              <Prop
                readOnly
                label="Include rows when"
                value={block.rowWhen ? <Code>{block.rowWhen}</Code> : "Always"}
              />
              <Prop
                readOnly
                label="Total"
                value={block.total ? labelOf(block.total.path) : "None"}
              />
            </>
          ) : (
            <>
              <Prop
                label="Include rows when"
                htmlFor={`${id}-when`}
                optional
                hint="An expression over the row, like $.excluded == false."
              >
                <Input
                  id={`${id}-when`}
                  className="font-mono text-xs"
                  spellCheck={false}
                  value={block.rowWhen ?? ""}
                  onChange={(event) =>
                    onChange({ ...block, rowWhen: optional(event.target.value) })
                  }
                />
              </Prop>
              <Prop label="Total" htmlFor={`${id}-total`} optional>
                <Select
                  value={block.total?.path ?? "none"}
                  onValueChange={(path) => {
                    const { total: _, ...rest } = block;

                    onChange(
                      path === "none" ? rest : { ...rest, total: { label: labelOf(path), path } },
                    );
                  }}
                >
                  <SelectTrigger id={`${id}-total`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {totals.map(([path, node]) => (
                      <SelectItem key={path} value={path}>
                        {node.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Prop>
            </>
          )}
        </InspectorSection>
      )}
    </>
  );
}

function BlockFields(props: Props) {
  const { block, onChange, schema, readOnly, clauses } = props;
  const id = useId();

  const text = (
    label: string,
    key: string,
    extra: Partial<Parameters<typeof TextProp>[0]> = {},
  ) => (
    <TextProp
      label={label}
      value={(block as unknown as Record<string, string | undefined>)[key]}
      onChange={(value) =>
        onChange({ ...block, [key]: extra.optional ? optional(value) : value } as Block)
      }
      readOnly={readOnly}
      schema={schema}
      {...extra}
    />
  );

  switch (block.type) {
    case "header":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Document title", "title")}
          {text("Subtitle", "subtitle", { optional: true })}
        </InspectorSection>
      );
    case "heading":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Text", "text")}
        </InspectorSection>
      );
    case "text":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Wording", "body", {
            multiline: true,
            hint: "Blank lines start paragraphs, - starts a bullet, **bold** for emphasis.",
          })}
        </InspectorSection>
      );
    case "notice":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Title", "title", { optional: true })}
          {text("Wording", "body", { multiline: true })}
        </InspectorSection>
      );
    case "keyValue":
      return <KeyValueFields {...props} block={block} onChange={onChange as never} />;
    case "exposureTable":
      return <ExposureFields {...props} block={block} onChange={onChange as never} />;
    case "dataTable":
      return <DataTableFields {...props} block={block} onChange={onChange as never} />;
    case "coverageSchedule":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Title", "title", { optional: true, merge: false })}
          {(["limit", "deductible", "premium"] as const).map((column) => (
            <FlagProp
              key={column}
              label={`${column.charAt(0).toUpperCase()}${column.slice(1)} column`}
              description={
                column === "premium"
                  ? "Shows a dash until the quote is rated."
                  : `The selected ${column} for each coverage.`
              }
              checked={block[column]}
              onChange={(checked) => onChange({ ...block, [column]: checked })}
              readOnly={readOnly}
            />
          ))}
        </InspectorSection>
      );
    case "formsSchedule":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {text("Title", "title", { optional: true, merge: false })}
        </InspectorSection>
      );
    case "clause":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          {readOnly ? (
            <Prop
              readOnly
              label="Clause"
              value={clauses.find((c) => c.key === block.clause)?.title ?? block.clause}
            />
          ) : (
            <Prop
              label="Clause"
              htmlFor={id}
              hint="State variants are picked by the policy's jurisdiction."
            >
              <Select
                value={block.clause || undefined}
                onValueChange={(clause) => onChange({ ...block, clause })}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Choose a clause" />
                </SelectTrigger>
                <SelectContent>
                  {clauses.map((clause) => (
                    <SelectItem key={clause.key} value={clause.key}>
                      {clause.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Prop>
          )}
        </InspectorSection>
      );
    case "signature":
      return (
        <InspectorSection title="Content" readOnly={readOnly}>
          <PropRow>
            {text("Signer role", "role", { merge: false })}
            {text("Printed name", "name", { optional: true })}
          </PropRow>
          <FlagProp
            label="Date line"
            description="Adds a line for the signing date."
            checked={block.date}
            onChange={(date) => onChange({ ...block, date })}
            readOnly={readOnly}
          />
        </InspectorSection>
      );
    case "pageBreak":
      return null;
  }
}

export function BlockInspector(props: Props) {
  const { block, onChange, schema, readOnly } = props;
  const id = useId();
  const extra = useDocumentFields();

  const expressionSchema = useMemo(() => contextSchema(schema, "document", extra), [schema, extra]);

  return (
    <InspectorBody>
      <BlockFields {...props} />
      <InspectorSection title="Visibility" readOnly={readOnly}>
        {readOnly ? (
          <Prop
            readOnly
            label="Show when"
            value={block.showWhen ? <ExpressionView value={block.showWhen} /> : "Always"}
          />
        ) : (
          <Prop label="Show when" htmlFor={id} optional>
            <ExpressionInput
              id={id}
              value={block.showWhen ?? ""}
              onChange={(value) => onChange({ ...block, showWhen: optional(value) })}
              schema={expressionSchema}
              placeholder={'"water_backup" in coverages'}
              hint="Leave empty to always show this block."
            />
          </Prop>
        )}
      </InspectorSection>
    </InspectorBody>
  );
}
