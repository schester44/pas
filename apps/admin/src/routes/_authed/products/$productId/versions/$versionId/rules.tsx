import { DECISION_KINDS, type DecisionKind, type JdmDecision } from "@pas/decisions-engine";
import { useExpressionsReady } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { cn } from "@pas/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { Ellipsis, Plus, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import { useVersionEditor, type VersionDecision } from "@/components/catalog/version-editor";
import { DecisionEditor } from "@/components/decisions/decision-editor";
import { tableNodes } from "@/components/decisions/jdm-edit";
import { AddDecisionDialog, RenameDecisionDialog } from "@/components/rules/decision-dialogs";
import { DecisionTests } from "@/components/rules/decision-tests";
import {
  decisionRef,
  decisionSample,
  decisionSchema,
  KIND_COPY,
  KIND_ORDER,
  runTest,
} from "@/components/rules/rules";
import { useAccess } from "@/lib/permissions";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/rules")({
  validateSearch: (search: Record<string, unknown>): { decision?: string } =>
    typeof search.decision === "string" ? { decision: search.decision } : {},
  component: RulesTab,
});

function RulesTab() {
  const access = useAccess();
  const { version, contents, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<VersionDecision>();
  const [deleting, setDeleting] = useState<VersionDecision>();

  const readOnly = version.status !== "draft" || !access.decisions.write;
  const rules = contents.rules;
  const schema = useMemo(() => decisionSchema(contents), [contents]);
  const selected = rules.find((d) => decisionRef(d) === search.decision) ?? rules[0];
  const select = (ref: string) => navigate({ search: { decision: ref }, replace: true });

  const replace = (target: VersionDecision, next: VersionDecision, immediate?: boolean) =>
    set(
      "rules",
      rules.map((d) => (d === target ? next : d)),
      immediate,
    );

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
      <Plus /> Add decision
    </Button>
  );

  return (
    <PageBody>
      {rules.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Scale />}
            title="No decisions yet"
            description="Decisions refer and decline risks, add taxes and fees and pick forms for this version."
            action={addAction}
          />
        </Panel>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <DecisionList
            rules={rules}
            selected={selected}
            readOnly={readOnly}
            onSelect={(d) => select(decisionRef(d))}
            onRename={setRenaming}
            onDelete={setDeleting}
            action={addAction}
          />
          {selected && (
            <SelectedDecision
              key={decisionRef(selected)}
              decision={selected}
              schema={schema}
              sample={decisionSample(contents)}
              readOnly={readOnly}
              onChange={(next, immediate) => replace(selected, next, immediate)}
            />
          )}
        </div>
      )}
      <AddDecisionDialog
        open={adding}
        onOpenChange={setAdding}
        existing={rules}
        onAdd={(decision) => {
          set("rules", [...rules, decision], true);
          select(decisionRef(decision));
        }}
      />
      <RenameDecisionDialog
        decision={renaming}
        onOpenChange={(open) => !open && setRenaming(undefined)}
        onRename={(name) => {
          if (!renaming) return;

          replace(renaming, rename(renaming, name), true);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete ${deleting?.name ?? "decision"}?`}
        description="Its table and saved tests are removed from this version."
        confirmLabel="Delete decision"
        onConfirm={() =>
          set(
            "rules",
            rules.filter((d) => d !== deleting),
            true,
          )
        }
      />
    </PageBody>
  );
}

function rename(decision: VersionDecision, name: string): VersionDecision {
  const [first] = tableNodes(decision.decision);

  const artifact: JdmDecision = {
    ...decision.decision,
    nodes: decision.decision.nodes.map((node) => (node === first ? { ...node, name } : node)),
  };

  return { ...decision, name, decision: artifact };
}

function DecisionList({
  rules,
  selected,
  readOnly,
  onSelect,
  onRename,
  onDelete,
  action,
}: {
  rules: VersionDecision[];
  selected: VersionDecision | undefined;
  readOnly: boolean;
  onSelect: (decision: VersionDecision) => void;
  onRename: (decision: VersionDecision) => void;
  onDelete: (decision: VersionDecision) => void;
  action: React.ReactNode;
}) {
  const ready = useExpressionsReady();

  const groups = KIND_ORDER.flatMap((kind) => {
    const items = rules.filter((d) => d.kind === kind);

    return items.length ? [{ kind, items }] : [];
  });

  return (
    <Panel flush title="Decisions" action={action} className="lg:sticky lg:top-20">
      <div className="grid divide-y">
        {groups.map(({ kind, items }) => (
          <section key={kind} className="grid gap-1 py-3">
            <header className="grid gap-0.5 px-(--card-p) pb-1">
              <h3 className="m-0 text-xs font-medium text-foreground">
                {DECISION_KINDS[kind].label}
              </h3>
              <p className="m-0 text-xs text-muted-foreground">{KIND_COPY[kind]}</p>
            </header>
            <ul className="m-0 grid list-none gap-0.5 px-2 p-0">
              {items.map((decision) => (
                <DecisionItem
                  key={decisionRef(decision)}
                  decision={decision}
                  active={decision === selected}
                  ready={ready}
                  readOnly={readOnly}
                  onSelect={() => onSelect(decision)}
                  onRename={() => onRename(decision)}
                  onDelete={() => onDelete(decision)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

function DecisionItem({
  decision,
  active,
  ready,
  readOnly,
  onSelect,
  onRename,
  onDelete,
}: {
  decision: VersionDecision;
  active: boolean;
  ready: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const failing = ready ? decision.tests.filter((test) => !runTest(decision, test).passed) : [];
  const total = decision.tests.length;

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className={cn(
          "grid w-full gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
          active ? "bg-primary/5" : "hover:bg-muted/60",
        )}
      >
        <span className="truncate pr-6 text-sm font-medium">{decision.name || decision.key}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <code className="font-mono text-[0.6875rem]">{decisionRef(decision)}</code>
          {total > 0 && (
            <>
              <span aria-hidden>·</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 tabular-nums",
                  failing.length > 0 && "text-red-700",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    failing.length > 0 ? "bg-red-500" : "bg-emerald-500",
                  )}
                />
                {failing.length > 0
                  ? `${failing.length} of ${total} failing`
                  : `${total} ${total === 1 ? "test" : "tests"}`}
              </span>
            </>
          )}
        </span>
      </button>
      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${decision.name} actions`}
              className="absolute top-1.5 right-1.5 size-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function SelectedDecision({
  decision,
  schema,
  sample,
  readOnly,
  onChange,
}: {
  decision: VersionDecision;
  schema: ReturnType<typeof decisionSchema>;
  sample: Record<string, unknown>;
  readOnly: boolean;
  onChange: (next: VersionDecision, immediate?: boolean) => void;
}) {
  const [input, setInput] = useState<Record<string, unknown>>(sample);

  return (
    <div className="grid min-w-0 gap-6">
      <DecisionEditor
        kind={decision.kind as DecisionKind}
        value={decision.decision}
        onChange={(artifact) => onChange({ ...decision, decision: artifact })}
        schema={schema}
        readOnly={readOnly}
        input={input}
        onInputChange={setInput}
      />
      <DecisionTests
        decision={decision}
        input={input}
        readOnly={readOnly}
        onLoad={setInput}
        onChange={(tests) => onChange({ ...decision, tests }, true)}
      />
    </div>
  );
}
