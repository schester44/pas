import { FIELD_KINDS, type FieldKind, type FieldNode, type SchemaNode } from "@pas/forms-core";
import { Input } from "@pas/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Textarea } from "@pas/ui/components/textarea";
import { ArrowDown, ArrowUp, Copy, Trash } from "lucide-react";
import { useId } from "react";
import {
  Code,
  FlagProp,
  IconAction,
  InspectorBody,
  InspectorHeader,
  InspectorSection,
  Prop,
  PropRow,
} from "./inspector";
import { hasOptions, KIND_META } from "./kinds";
import { OptionsEditor } from "./options-editor";
import {
  type Container,
  canonicalPathAt,
  isContainer,
  type NodePath,
  problemsOf,
  siblingsAt,
} from "./schema-tree";

interface SchemaInspectorProps {
  nodes: SchemaNode[];
  path: NodePath;
  readOnly?: boolean;
  onChange: (node: SchemaNode) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const COUNTRY_KINDS = new Set<FieldKind>(["address", "phone"]);

export function SchemaInspector({
  nodes,
  path,
  readOnly,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: SchemaInspectorProps) {
  const id = useId();
  const siblings = siblingsAt(nodes, path);
  const index = path.at(-1)!;
  const node = siblings[index]!;
  const problems = problemsOf(node, siblings);
  const canonical = canonicalPathAt(nodes, path);
  const meta = KIND_META[node.kind];
  const patch = (changes: Partial<SchemaNode>) => onChange({ ...node, ...changes } as SchemaNode);

  return (
    <div>
      <InspectorHeader
        icon={meta.icon}
        title={node.label || node.key || "Untitled"}
        subtitle={meta.label}
        actions={
          !readOnly && (
            <>
              <IconAction
                label="Move up"
                icon={ArrowUp}
                disabled={index === 0}
                onClick={() => onMove(-1)}
              />
              <IconAction
                label="Move down"
                icon={ArrowDown}
                disabled={index === siblings.length - 1}
                onClick={() => onMove(1)}
              />
              <IconAction label="Duplicate" icon={Copy} onClick={onDuplicate} />
              <IconAction
                label="Delete"
                icon={Trash}
                onClick={onDelete}
                className="hover:bg-red-50 hover:text-destructive"
              />
            </>
          )
        }
      />
      <InspectorBody>
        <InspectorSection title="Definition" readOnly={readOnly}>
          <PropRow>
            <Prop
              label="Label"
              htmlFor={`${id}-label`}
              readOnly={readOnly}
              value={node.label}
              error={problems.label}
            >
              <Input
                id={`${id}-label`}
                value={node.label}
                aria-invalid={!!problems.label}
                onChange={(event) => patch({ label: event.target.value })}
              />
            </Prop>
            <Prop
              label="Key"
              htmlFor={`${id}-key`}
              readOnly={readOnly}
              value={<Code>{node.key}</Code>}
              error={problems.key}
              hint={
                <>
                  Path <Code className="text-muted-foreground">{canonical || "–"}</Code>
                </>
              }
            >
              <Input
                id={`${id}-key`}
                value={node.key}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!problems.key}
                className="font-mono text-[0.8125rem]"
                onChange={(event) => patch({ key: event.target.value.trim() })}
              />
            </Prop>
          </PropRow>
          {readOnly && <Prop readOnly label="Path" value={<Code>{canonical}</Code>} />}
          <Prop label="Type" htmlFor={`${id}-kind`} readOnly={readOnly} value={meta.label}>
            <KindSelect id={`${id}-kind`} node={node} onChange={onChange} />
          </Prop>
          <Prop
            label="Description"
            htmlFor={`${id}-description`}
            optional
            readOnly={readOnly}
            value={node.description}
            hint={isContainer(node) ? undefined : "Shown as help text under the field on forms."}
          >
            <Textarea
              id={`${id}-description`}
              value={node.description ?? ""}
              className="min-h-16"
              onChange={(event) => patch({ description: event.target.value || undefined })}
            />
          </Prop>
        </InspectorSection>

        {isContainer(node) ? (
          <ContainerSections
            node={node}
            readOnly={readOnly}
            problems={problems}
            onChange={patch}
            id={id}
          />
        ) : (
          <FieldSections
            node={node}
            readOnly={readOnly}
            problems={problems}
            onChange={patch}
            id={id}
          />
        )}
      </InspectorBody>
    </div>
  );
}

function KindSelect({
  id,
  node,
  onChange,
}: {
  id: string;
  node: SchemaNode;
  onChange: (node: SchemaNode) => void;
}) {
  const kinds: SchemaNode["kind"][] = isContainer(node)
    ? ["group", "repeatable"]
    : [...FIELD_KINDS];

  return (
    <Select
      value={node.kind}
      onValueChange={(kind) => onChange(changeKind(node, kind as SchemaNode["kind"]))}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((kind) => {
          const Icon = KIND_META[kind].icon;

          return (
            <SelectItem key={kind} value={kind}>
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {KIND_META[kind].label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function changeKind(node: SchemaNode, kind: SchemaNode["kind"]): SchemaNode {
  if (isContainer(node)) {
    const {
      minItems: _min,
      maxItems: _max,
      ...rest
    } = node as Container & {
      minItems?: number;
      maxItems?: number;
    };

    return kind === "repeatable"
      ? { ...node, kind: "repeatable" }
      : { ...rest, kind: "group", children: node.children };
  }

  const field = node as FieldNode;
  const next: FieldNode = { ...field, kind: kind as FieldKind };

  if (!hasOptions(next.kind)) delete next.options;
  else if (!next.options?.length) next.options = [{ label: "Option 1", value: "option_1" }];

  if (next.kind !== "money") delete next.currency;

  if (!COUNTRY_KINDS.has(next.kind)) delete next.country;

  return next;
}

interface SectionProps<T extends SchemaNode> {
  id: string;
  node: T;
  readOnly?: boolean;
  problems: ReturnType<typeof problemsOf>;
  onChange: (changes: Partial<T>) => void;
}

const parseCount = (raw: string) => (raw === "" ? undefined : Math.max(0, Math.trunc(Number(raw))));

function ContainerSections({ id, node, readOnly, problems, onChange }: SectionProps<Container>) {
  const exposed = node.exposure !== undefined;

  return (
    <>
      {node.kind === "repeatable" && (
        <InspectorSection title="Entries" readOnly={readOnly}>
          <PropRow>
            <Prop
              label="Minimum"
              htmlFor={`${id}-min`}
              optional
              readOnly={readOnly}
              value={node.minItems}
              error={problems.items}
            >
              <Input
                id={`${id}-min`}
                type="number"
                min={0}
                inputMode="numeric"
                className="tabular-nums"
                value={node.minItems ?? ""}
                onChange={(event) => onChange({ minItems: parseCount(event.target.value) })}
              />
            </Prop>
            <Prop
              label="Maximum"
              htmlFor={`${id}-max`}
              optional
              readOnly={readOnly}
              value={node.maxItems}
            >
              <Input
                id={`${id}-max`}
                type="number"
                min={1}
                inputMode="numeric"
                className="tabular-nums"
                value={node.maxItems ?? ""}
                onChange={(event) => onChange({ maxItems: parseCount(event.target.value) })}
              />
            </Prop>
          </PropRow>
        </InspectorSection>
      )}
      <InspectorSection title="Exposure" readOnly={readOnly}>
        {readOnly ? (
          <Prop
            readOnly
            label="Exposure type"
            value={node.exposure && <Code>{node.exposure}</Code>}
          />
        ) : (
          <>
            <FlagProp
              label="This is an exposure"
              description={`Coverages, limits and premium attach to ${node.kind === "repeatable" ? "each entry" : "this group"}.`}
              checked={exposed}
              onChange={(checked) => onChange({ exposure: checked ? node.key : undefined })}
            />
            {exposed && (
              <Prop
                label="Exposure type"
                htmlFor={`${id}-exposure`}
                error={problems.exposure}
                hint="The coverage catalog refers to this name, like location, vehicle or driver."
                className="pl-7"
              >
                <Input
                  id={`${id}-exposure`}
                  value={node.exposure}
                  spellCheck={false}
                  aria-invalid={!!problems.exposure}
                  className="font-mono text-[0.8125rem]"
                  onChange={(event) => onChange({ exposure: event.target.value })}
                />
              </Prop>
            )}
          </>
        )}
      </InspectorSection>
    </>
  );
}

function FieldSections({ id, node, readOnly, problems, onChange }: SectionProps<FieldNode>) {
  return (
    <>
      {hasOptions(node.kind) && (
        <InspectorSection title="Options">
          <OptionsEditor
            options={node.options ?? []}
            readOnly={readOnly}
            error={problems.options}
            onChange={(options) => onChange({ options })}
          />
        </InspectorSection>
      )}
      {(node.kind === "money" || COUNTRY_KINDS.has(node.kind)) && (
        <InspectorSection title="Format" readOnly={readOnly}>
          {node.kind === "money" ? (
            <Prop
              label="Currency"
              htmlFor={`${id}-currency`}
              optional
              readOnly={readOnly}
              value={node.currency}
              error={problems.currency}
              hint="Amounts are entered and stored in this currency."
              className="max-w-40"
            >
              <Input
                id={`${id}-currency`}
                value={node.currency ?? ""}
                maxLength={3}
                placeholder="USD"
                aria-invalid={!!problems.currency}
                className="font-mono uppercase"
                onChange={(event) =>
                  onChange({ currency: event.target.value.toUpperCase() || undefined })
                }
              />
            </Prop>
          ) : (
            <Prop
              label="Country"
              htmlFor={`${id}-country`}
              optional
              readOnly={readOnly}
              value={node.country}
              error={problems.country}
              hint={
                node.kind === "address"
                  ? "Sets the address format."
                  : "Sets the default dialling region."
              }
              className="max-w-40"
            >
              <Input
                id={`${id}-country`}
                value={node.country ?? ""}
                maxLength={2}
                placeholder="US"
                aria-invalid={!!problems.country}
                className="font-mono uppercase"
                onChange={(event) =>
                  onChange({ country: event.target.value.toUpperCase() || undefined })
                }
              />
            </Prop>
          )}
        </InspectorSection>
      )}
      <InspectorSection title="Handling" readOnly={readOnly}>
        <FlagProp
          label="Endorsable"
          description="Can change mid-term through an endorsement."
          checked={node.endorsable === true}
          readOnly={readOnly}
          onChange={(checked) => onChange({ endorsable: checked || undefined })}
        />
        <FlagProp
          label="Personal data"
          description="Masked in logs and exports, and subject to retention rules."
          checked={node.pii === true}
          readOnly={readOnly}
          onChange={(checked) => onChange({ pii: checked || undefined })}
        />
      </InspectorSection>
    </>
  );
}
