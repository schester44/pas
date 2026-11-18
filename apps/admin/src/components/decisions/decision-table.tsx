import {
  contractFields,
  DECISION_KINDS,
  type DecisionIssue,
  type DecisionKind,
  type DecisionTableContent,
  ruleCell,
  type TableColumn,
} from "@pas/decisions-engine";
import type { RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { cn } from "@pas/ui/lib/utils";
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { friendly } from "../builders/expression-input";
import { PathPicker } from "../builders/path-picker";
import {
  blankRule,
  humanize,
  moveRule,
  newId,
  removeColumn,
  setCell,
  type TableNode,
} from "./jdm-edit";

type Side = "inputs" | "outputs";

const WIDE_FIELDS = new Set(["message", "internalMessage", "label", "allowedReasons"]);

const issueTone = (issue: DecisionIssue) =>
  issue.code === "invalid_expression" || issue.code === "invalid_output" ? "error" : "warning";

const issueText = (issue: DecisionIssue) =>
  issue.code === "invalid_expression" ? friendly(issue.message) : `${issue.message}.`;

export const HIT_POLICIES = {
  first: "First match",
  collect: "Collect all",
} as const;

export function DecisionTable({
  kind,
  node,
  schema,
  issues,
  matched,
  readOnly,
  onChange,
}: {
  kind: DecisionKind;
  node: TableNode;
  schema: RiskSchema;
  issues: DecisionIssue[];
  matched?: ReadonlySet<string>;
  readOnly?: boolean;
  onChange: (content: DecisionTableContent) => void;
}) {
  const content = node.content as DecisionTableContent;
  const { inputs, outputs, rules } = content;

  const cellIssues = useMemo(() => {
    const map = new Map<string, DecisionIssue>();

    for (const issue of issues) {
      const key = `${issue.ruleId ?? ""}:${issue.columnId ?? ""}`;
      const current = map.get(key);

      if (!current || (issueTone(issue) === "error" && issueTone(current) !== "error")) {
        map.set(key, issue);
      }
    }

    return map;
  }, [issues]);

  const update = (patch: Partial<DecisionTableContent>) => onChange({ ...content, ...patch });

  const updateColumn = (side: Side, column: TableColumn) =>
    update({ [side]: content[side].map((c) => (c.id === column.id ? column : c)) });

  const columns: { side: Side; column: TableColumn }[] = [
    ...inputs.map((column) => ({ side: "inputs" as const, column })),
    ...outputs.map((column) => ({ side: "outputs" as const, column })),
  ];

  return (
    <div className="relative w-full overflow-x-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="w-12 border-b pl-(--card-p)" rowSpan={2} aria-label="Row" />
            <GroupHead span={inputs.length} label="Conditions" />
            <GroupHead span={outputs.length} label="Results" divider />
            <th
              className="min-w-56 border-b pb-3 text-left align-bottom"
              rowSpan={2}
              aria-label="Description"
            >
              <span className="px-3 text-xs font-medium text-muted-foreground">Description</span>
            </th>
            {!readOnly && <th className="w-12 border-b pr-(--card-p)" rowSpan={2} />}
          </tr>
          <tr>
            {columns.map(({ side, column }) => (
              <th
                key={column.id}
                className={cn(
                  "border-b px-1.5 pb-1.5 text-left align-bottom font-normal",
                  side === "outputs" && column.id === outputs[0]?.id && "border-l",
                  WIDE_FIELDS.has(column.field ?? "") ? "min-w-64" : "min-w-28",
                )}
              >
                <ColumnHeader
                  kind={kind}
                  side={side}
                  column={column}
                  schema={schema}
                  siblings={content[side].filter((c) => c.id !== column.id)}
                  issue={cellIssues.get(`:${column.id}`)}
                  readOnly={readOnly}
                  removable={content[side].length > 1}
                  onChange={(next) => updateColumn(side, next)}
                  onRemove={() => onChange(removeColumn(content, side, column.id))}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => {
            const hit = matched?.has(rule._id);

            return (
              <tr key={rule._id} className={cn("group/row", hit && "bg-primary/5")}>
                <td
                  className={cn(
                    "border-b pl-(--card-p) align-top text-xs tabular-nums text-muted-foreground",
                    hit && "font-medium text-primary shadow-[inset_2px_0_0_var(--color-primary)]",
                  )}
                >
                  <span className="flex h-11 items-center" title={hit ? "Matched" : undefined}>
                    {index + 1}
                  </span>
                </td>
                {columns.map(({ side, column }) => (
                  <td
                    key={column.id}
                    className={cn(
                      "border-b px-1.5 py-1.5 align-top",
                      side === "outputs" && column.id === outputs[0]?.id && "border-l",
                    )}
                  >
                    <Cell
                      value={ruleCell(rule, column.id)}
                      placeholder={side === "inputs" ? "any" : "–"}
                      issue={cellIssues.get(`${rule._id}:${column.id}`)}
                      readOnly={readOnly}
                      label={`Row ${index + 1}, ${column.name || column.field}`}
                      onChange={(value) =>
                        update({ rules: setCell(rules, rule._id, column.id, value) })
                      }
                    />
                  </td>
                ))}
                <td className="border-b px-1.5 py-1.5 align-top">
                  <Cell
                    value={rule._description ?? ""}
                    plain
                    readOnly={readOnly}
                    label={`Row ${index + 1} description`}
                    onChange={(value) =>
                      update({
                        rules: rules.map((r) =>
                          r._id === rule._id ? { ...r, _description: value } : r,
                        ),
                      })
                    }
                  />
                </td>
                {!readOnly && (
                  <td className="border-b pr-(--card-p) align-top">
                    <RowMenu
                      index={index}
                      count={rules.length}
                      onMove={(by) => update({ rules: moveRule(rules, index, by) })}
                      onDuplicate={() => {
                        const copy = { ...rule, _id: newId() };
                        update({ rules: rules.toSpliced(index + 1, 0, copy) });
                      }}
                      onDelete={() => update({ rules: rules.filter((r) => r._id !== rule._id) })}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!readOnly && (
        <div className="px-(--card-p) py-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={() => update({ rules: [...rules, blankRule()] })}
          >
            <Plus />
            Add row
          </Button>
        </div>
      )}
    </div>
  );
}

function GroupHead({ span, label, divider }: { span: number; label: string; divider?: boolean }) {
  if (span === 0) return null;

  return (
    <th
      colSpan={span}
      className={cn(
        "h-8 px-3 pt-2 text-left align-bottom text-xs font-medium text-muted-foreground",
        divider && "border-l",
      )}
    >
      {label}
    </th>
  );
}

function Cell({
  value,
  onChange,
  issue,
  readOnly,
  placeholder,
  plain,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  issue?: DecisionIssue;
  readOnly?: boolean;
  placeholder?: string;
  plain?: boolean;
  label: string;
}) {
  const tone = issue ? issueTone(issue) : undefined;
  const messageId = useId();

  const text = cn(
    plain ? "text-sm text-muted-foreground" : "font-mono text-[0.8125rem] text-foreground",
  );

  return (
    <div className="grid gap-1">
      {readOnly ? (
        <span className={cn("flex min-h-8 items-center px-2", "whitespace-nowrap", text)}>
          {value || <span className="text-muted-foreground">{placeholder}</span>}
        </span>
      ) : (
        <input
          value={value}
          aria-label={label}
          aria-invalid={tone === "error"}
          aria-describedby={issue ? messageId : undefined}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "h-8 min-w-full rounded-md border border-transparent bg-transparent px-2 outline-none transition-[color,box-shadow,border-color] [field-sizing:content]",
            "placeholder:text-muted-foreground/70 hover:border-input focus:border-ring focus:bg-background focus:ring-[3px] focus:ring-ring/50",
            tone === "error" &&
              "border-red-300 bg-red-50/60 hover:border-red-400 focus:border-destructive focus:ring-destructive/20",
            tone === "warning" &&
              "border-amber-300 bg-amber-50/60 hover:border-amber-400 focus:border-amber-400 focus:ring-amber-200/60",
            text,
          )}
        />
      )}
      {issue && (
        <p
          id={messageId}
          className={cn(
            "m-0 max-w-72 px-2 text-xs leading-4 whitespace-normal",
            tone === "error" ? "text-destructive" : "text-amber-900",
          )}
        >
          {issueText(issue)}
        </p>
      )}
    </div>
  );
}

function ColumnHeader({
  kind,
  side,
  column,
  schema,
  siblings,
  issue,
  readOnly,
  removable,
  onChange,
  onRemove,
}: {
  kind: DecisionKind;
  side: Side;
  column: TableColumn;
  schema: RiskSchema;
  siblings: TableColumn[];
  issue?: DecisionIssue;
  readOnly?: boolean;
  removable: boolean;
  onChange: (column: TableColumn) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const contract = contractFields(kind);
  const required = side === "outputs" && contract.find((f) => f.key === column.field)?.required;

  const summary = (
    <span className="grid min-w-0 gap-0.5 text-left">
      <span className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap text-foreground">
        {column.name || humanize(column.field ?? "") || "Untitled"}
        {issue && (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              issueTone(issue) === "error" ? "bg-red-500" : "bg-amber-500",
            )}
          />
        )}
      </span>
      <code
        title={column.field}
        className="block max-w-36 truncate font-mono text-[0.6875rem] text-muted-foreground"
      >
        {column.field || (side === "inputs" ? "expression per row" : "no field")}
      </code>
    </span>
  );

  if (readOnly) return <div className="px-2 py-1">{summary}</div>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={issue ? issueText(issue) : undefined}
          className="flex w-full rounded-md px-2 py-1 outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted"
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="grid gap-4 p-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>Label</Label>
            <Input
              id={`${id}-name`}
              value={column.name}
              onChange={(event) => onChange({ ...column, name: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-field`}>
              {side === "inputs" ? "Reads" : "Writes"}
              {required && <span className="font-normal text-muted-foreground">required</span>}
            </Label>
            {side === "inputs" ? (
              <PathPicker
                id={`${id}-field`}
                schema={schema}
                value={column.field ?? ""}
                bound={new Set(siblings.map((s) => s.field ?? ""))}
                onChange={(field) => onChange({ ...column, field })}
              />
            ) : contract.length > 0 ? (
              <Select
                value={column.field}
                onValueChange={(field) => onChange({ ...column, field })}
              >
                <SelectTrigger id={`${id}-field`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {contract.map((field) => (
                    <SelectItem
                      key={field.key}
                      value={field.key}
                      disabled={siblings.some((s) => s.field === field.key)}
                      description={field.options?.join(", ")}
                    >
                      <span className="font-mono text-[0.8125rem]">{field.key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${id}-field`}
                value={column.field ?? ""}
                className="font-mono text-[0.8125rem]"
                onChange={(event) => onChange({ ...column, field: event.target.value })}
              />
            )}
            {issue && (
              <p
                className={cn(
                  "m-0 text-sm",
                  issueTone(issue) === "error" ? "text-destructive" : "text-amber-900",
                )}
              >
                {issueText(issue)}
              </p>
            )}
          </div>
        </div>
        {removable && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              <Trash2 />
              Remove column
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RowMenu({
  index,
  count,
  onMove,
  onDuplicate,
  onDelete,
}: {
  index: number;
  count: number;
  onMove: (by: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Row ${index + 1} actions`}
          className="mt-1.5 size-8 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
          <ArrowUp />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
          <ArrowDown />
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive"
          onSelect={onDelete}
        >
          <Trash2 />
          Delete row
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddColumnMenu({
  kind,
  content,
  onChange,
}: {
  kind: DecisionKind;
  content: DecisionTableContent;
  onChange: (content: DecisionTableContent) => void;
}) {
  const used = new Set(content.outputs.map((column) => column.field));
  const available = contractFields(kind).filter((field) => !used.has(field.key));
  const custom = !DECISION_KINDS[kind].row;

  const addOutput = (field: string) =>
    onChange({
      ...content,
      outputs: [...content.outputs, { id: newId(), name: humanize(field), field }],
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add column
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem
          onSelect={() =>
            onChange({
              ...content,
              inputs: [...content.inputs, { id: newId(), name: "", field: "" }],
            })
          }
        >
          Condition
        </DropdownMenuItem>
        {(available.length > 0 || custom) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Results</DropdownMenuLabel>
          </>
        )}
        {available.map((field) => (
          <DropdownMenuItem key={field.key} onSelect={() => addOutput(field.key)}>
            {humanize(field.key)}
            <code className="ml-auto pl-3 font-mono text-xs text-muted-foreground">
              {field.key}
            </code>
          </DropdownMenuItem>
        ))}
        {custom && (
          <DropdownMenuItem onSelect={() => addOutput(`result${content.outputs.length + 1}`)}>
            Custom result
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { issueText, issueTone };
