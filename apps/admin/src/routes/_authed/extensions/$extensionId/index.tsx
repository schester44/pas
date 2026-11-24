import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
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
import { cn } from "@pas/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileCode, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { CodeEditor } from "@/components/extensions/code-editor";
import { useExtensionEditor } from "@/components/extensions/extension-editor";
import {
  exportName,
  parseJson,
  pointLabel,
  prettyJson,
  SAMPLE_INPUTS,
} from "@/components/extensions/labels";
import { RunResult } from "@/components/extensions/run-result";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/$extensionId/")({
  component: CodeTab,
});

const ENTRY = "index.ts";
const FILE_NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.ts$/;

function CodeTab() {
  const { draft, set, readOnly } = useExtensionEditor();

  const names = Object.keys(draft.files).toSorted((a, b) =>
    a === ENTRY ? -1 : b === ENTRY ? 1 : a.localeCompare(b),
  );

  const [selected, setSelected] = useState(ENTRY);
  const [adding, setAdding] = useState<string | null>(null);
  const file = draft.files[selected] !== undefined ? selected : ENTRY;

  const setFile = (name: string, text: string) => set("files", { ...draft.files, [name]: text });

  const addFile = () => {
    const name = adding?.trim() ?? "";

    if (!FILE_NAME.test(name) || name in draft.files) return;

    set("files", { ...draft.files, [name]: "" }, true);
    setSelected(name);
    setAdding(null);
  };

  const removeFile = (name: string) => {
    const { [name]: _removed, ...rest } = draft.files;

    set("files", rest, true);
    setSelected(ENTRY);
  };

  return (
    <PageBody>
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <Panel
          flush
          title="Files"
          action={
            !readOnly && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Add file"
                onClick={() => setAdding("lib/")}
              >
                <Plus />
              </Button>
            )
          }
        >
          <ul className="m-0 grid list-none gap-0.5 p-2">
            {names.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => setSelected(name)}
                  className={cn(
                    "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-mono text-xs hover:bg-muted/60",
                    name === file && "bg-primary/5 text-foreground",
                  )}
                >
                  <FileCode aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {!readOnly && name !== ENTRY && (
                    <Trash2
                      aria-label={`Remove ${name}`}
                      className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(name);
                      }}
                    />
                  )}
                </button>
              </li>
            ))}
            {adding !== null && (
              <li className="p-1">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addFile();
                  }}
                >
                  <Input
                    autoFocus
                    aria-label="File name"
                    value={adding}
                    className="h-8 font-mono text-xs"
                    onChange={(e) => setAdding(e.target.value)}
                    onBlur={() => (adding.trim() ? addFile() : setAdding(null))}
                    onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
                  />
                </form>
              </li>
            )}
          </ul>
        </Panel>
        <div className="grid min-w-0 gap-6">
          <Panel flush title={<span className="font-mono text-sm">{file}</span>}>
            <CodeEditor
              key={file}
              label={file}
              value={draft.files[file] ?? ""}
              readOnly={readOnly}
              onChange={(text) => setFile(file, text)}
            />
          </Panel>
          <TryIt />
        </div>
      </div>
    </PageBody>
  );
}

function TryIt() {
  const trpc = useTRPC();
  const access = useAccess();
  const { extension, draft, flush } = useExtensionEditor();
  const points = draft.manifest.points;
  const [point, setPoint] = useState(points[0] ?? "validate");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  const text = inputs[point] ?? prettyJson(SAMPLE_INPUTS[point] ?? {});
  const parsed = parseJson(text);
  const run = useMutation(trpc.extensions.try.mutationOptions());

  return (
    <Panel
      title="Try it"
      description={`Runs the draft's ${exportName(point)}() once in the sandbox. Nothing is saved but the run.`}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-2">
            <Label htmlFor="try-point">Point</Label>
            <Select value={point} onValueChange={(p) => setPoint(p as typeof point)}>
              <SelectTrigger id="try-point" className="w-56">
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
          {access.extensions.publish && (
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox checked={live} onCheckedChange={(v) => setLive(v === true)} />
              Call the real hosts
            </label>
          )}
          <Button
            className="ml-auto"
            variant="outline"
            disabled={run.isPending || !parsed.ok || points.length === 0}
            onClick={async () => {
              await flush();

              if (parsed.ok) run.mutate({ id: extension.id, point, input: parsed.value, live });
            }}
          >
            {run.isPending && <Spinner />}
            Run
          </Button>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="try-input">Input</Label>
          <textarea
            id="try-input"
            value={text}
            spellCheck={false}
            onChange={(e) => setInputs({ ...inputs, [point]: e.target.value })}
            className="min-h-40 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-5 shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          {!parsed.ok && <p className="m-0 text-sm text-destructive">{parsed.error}</p>}
        </div>
        {run.error && (
          <Notice tone="error" title="Couldn't run the draft">
            {run.error.message}
          </Notice>
        )}
        {run.data && <RunResult run={run.data} />}
      </div>
    </Panel>
  );
}
