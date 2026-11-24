import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { type ExtensionTest, useExtensionEditor } from "@/components/extensions/extension-editor";
import { parseJson, pointLabel, prettyJson, SAMPLE_INPUTS } from "@/components/extensions/labels";
import { TestReportList } from "@/components/extensions/test-report";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/$extensionId/tests")({
  component: TestsTab,
});

function TestsTab() {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const { extension, draft, set, readOnly, flush } = useExtensionEditor();
  const [editing, setEditing] = useState<ExtensionTest | null>(null);

  const test = useMutation(
    trpc.extensions.test.mutationOptions({
      onSuccess: (_, input) =>
        input.record
          ? queryClient.invalidateQueries({
              queryKey: trpc.extensions.get.queryKey({ id: extension.id }),
            })
          : undefined,
    }),
  );

  const run = async (record: boolean) => {
    await flush();
    test.mutate({ id: extension.id, record });
  };

  const save = (next: ExtensionTest) => {
    const exists = draft.tests.some((t) => t.id === next.id);

    set(
      "tests",
      exists ? draft.tests.map((t) => (t.id === next.id ? next : t)) : [...draft.tests, next],
      true,
    );

    setEditing(null);
  };

  return (
    <PageBody className="max-w-6xl">
      <Panel
        flush
        title="Tests"
        description="Every point needs a test, and every test must pass to publish. Recorded responses answer network calls in tests and sandboxes."
        action={
          <div className="flex gap-2">
            {!readOnly && access.extensions.publish && (
              <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => run(true)}>
                Record from real hosts
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending || draft.tests.length === 0}
              onClick={() => run(false)}
            >
              {test.isPending && <Spinner />}
              Run tests
            </Button>
            {!readOnly && (
              <Button
                size="sm"
                onClick={() =>
                  setEditing({
                    id: crypto.randomUUID(),
                    name: "",
                    point: draft.manifest.points[0] ?? "validate",
                    input: SAMPLE_INPUTS[draft.manifest.points[0] ?? "validate"] ?? {},
                    network: [],
                  })
                }
              >
                <Plus /> Add test
              </Button>
            )}
          </div>
        }
      >
        {draft.tests.length === 0 ? (
          <EmptyState
            title="No tests yet"
            description="Add one for each point this extension implements."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Test</TableHead>
                <TableHead>Point</TableHead>
                <TableHead>Expects</TableHead>
                <TableHead className="text-right">Recorded responses</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.tests.map((t) => (
                <TableRow
                  key={t.id}
                  className="h-13 cursor-pointer hover:bg-muted/40"
                  onClick={() => setEditing(t)}
                >
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="text-muted-foreground">{pointLabel(t.point)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.expectFailure
                      ? "A failure"
                      : t.expected !== undefined
                        ? "This exact output"
                        : "Any valid output"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.network.length || "–"}
                  </TableCell>
                  <TableCell>
                    {!readOnly && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove test"
                        onClick={(e) => {
                          e.stopPropagation();

                          set(
                            "tests",
                            draft.tests.filter((x) => x.id !== t.id),
                            true,
                          );
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {test.error && (
        <Notice tone="error" title="Couldn't run the tests">
          {test.error.message}
        </Notice>
      )}
      {test.data && (
        <Panel title={test.data.passed ? "All tests passed" : "Some tests failed"}>
          <TestReportList report={test.data} />
        </Panel>
      )}
      {editing && (
        <TestDialog
          test={editing}
          points={draft.manifest.points}
          readOnly={readOnly}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </PageBody>
  );
}

function TestDialog({
  test,
  points,
  readOnly,
  onCancel,
  onSave,
}: {
  test: ExtensionTest;
  points: readonly ExtensionTest["point"][];
  readOnly: boolean;
  onCancel: () => void;
  onSave: (test: ExtensionTest) => void;
}) {
  const [name, setName] = useState(test.name);
  const [point, setPoint] = useState(test.point);
  const [input, setInput] = useState(prettyJson(test.input));
  const [checkOutput, setCheckOutput] = useState(test.expected !== undefined);
  const [expected, setExpected] = useState(prettyJson(test.expected ?? null));
  const [expectFailure, setExpectFailure] = useState(!!test.expectFailure);
  const parsedInput = parseJson(input);
  const parsedExpected = parseJson(expected);
  const valid = !!name.trim() && parsedInput.ok && (!checkOutput || parsedExpected.ok);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{test.name || "New test"}</DialogTitle>
          <DialogDescription>
            {test.network.length > 0
              ? `${test.network.length} recorded responses answer this test's network calls.`
              : "Record from real hosts to capture the responses this test needs."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();

            if (!valid || !parsedInput.ok) return;

            const { expected: _e, expectFailure: _f, ...rest } = test;

            onSave({
              ...rest,
              name: name.trim(),
              point,
              input: parsedInput.value,
              ...(expectFailure ? { expectFailure: true } : {}),
              ...(checkOutput && !expectFailure && parsedExpected.ok
                ? { expected: parsedExpected.value }
                : {}),
            });
          }}
        >
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="test-name">Name</Label>
                <Input id="test-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="test-point">Point</Label>
                <Select value={point} onValueChange={(p) => setPoint(p as typeof point)}>
                  <SelectTrigger id="test-point">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {points.map((p) => (
                      <SelectItem key={p} value={p}>
                        {pointLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="test-input">Input</Label>
              <textarea
                id="test-input"
                value={input}
                spellCheck={false}
                onChange={(e) => setInput(e.target.value)}
                className="min-h-40 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              {!parsedInput.ok && (
                <p className="m-0 text-sm text-destructive">{parsedInput.error}</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={expectFailure}
                onCheckedChange={(v) => setExpectFailure(v === true)}
              />
              The extension should fail on this input
            </label>
            {!expectFailure && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checkOutput}
                  onCheckedChange={(v) => setCheckOutput(v === true)}
                />
                Check the output exactly
              </label>
            )}
            {checkOutput && !expectFailure && (
              <div className="grid gap-2">
                <Label htmlFor="test-expected">Expected output</Label>
                <textarea
                  id="test-expected"
                  value={expected}
                  spellCheck={false}
                  onChange={(e) => setExpected(e.target.value)}
                  className="min-h-32 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                {!parsedExpected.ok && (
                  <p className="m-0 text-sm text-destructive">{parsedExpected.error}</p>
                )}
              </div>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={!valid}>
                Save test
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
