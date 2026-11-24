import type { AdminOutputs } from "@pas/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SaveState } from "@/components/catalog/version-editor";
import { useTRPC } from "@/lib/trpc";

export type ExtensionDetail = AdminOutputs["extensions"]["get"];
export type Draft = ExtensionDetail["draft"];
export type Manifest = Draft["manifest"];
export type ExtensionTest = Draft["tests"][number];
export type TestReport = AdminOutputs["extensions"]["test"];
export type RunDetail = AdminOutputs["extensions"]["run"];

interface ExtensionEditorValue {
  extension: ExtensionDetail;
  draft: Draft;
  readOnly: boolean;
  saveState: SaveState;
  set: <K extends keyof Draft>(key: K, value: Draft[K], immediate?: boolean) => void;
  flush: () => Promise<void>;
  retry: () => void;
}

const ExtensionEditorContext = createContext<ExtensionEditorValue | null>(null);

const AUTOSAVE_DELAY = 800;

/** The extension's draft, autosaved like a product version's contents. */
export function ExtensionEditorProvider({
  extension,
  canEdit,
  children,
}: {
  extension: ExtensionDetail;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(extension.draft);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pending = useRef<Partial<Draft>>({});

  // The server changes the draft too (recording fixtures); take it when nothing is unsaved here.
  useEffect(() => {
    if (Object.keys(pending.current).length === 0) setDraft(extension.draft);
  }, [extension.draft]);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const { mutateAsync } = useMutation(trpc.extensions.update.mutationOptions());

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);

    for (;;) {
      if (inFlight.current) await inFlight.current;

      const changes = pending.current;

      if (Object.keys(changes).length === 0) return;

      pending.current = {};
      setSaveState("saving");

      let failed = false;

      const run = mutateAsync({ id: extension.id, draft: changes })
        .then(async () => {
          await queryClient.invalidateQueries({ queryKey: trpc.extensions.list.queryKey() });
          setSaveState(Object.keys(pending.current).length > 0 ? "saving" : "saved");
        })
        .catch(() => {
          failed = true;
          pending.current = { ...changes, ...pending.current };
          setSaveState("error");
        })
        .finally(() => {
          inFlight.current = null;
        });

      inFlight.current = run;
      await run;

      if (failed) return;
    }
  }, [mutateAsync, queryClient, trpc, extension.id]);

  const set = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K], immediate?: boolean) => {
      setDraft((current) => ({ ...current, [key]: value }));
      pending.current = { ...pending.current, [key]: value };
      setSaveState("saving");
      clearTimeout(timer.current);

      if (immediate) void save();
      else timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY);
    },
    [save],
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length > 0 || inFlight.current) event.preventDefault();
    };

    window.addEventListener("beforeunload", warn);

    return () => {
      window.removeEventListener("beforeunload", warn);
      clearTimeout(timer.current);

      if (Object.keys(pending.current).length > 0) void save();
    };
  }, [save]);

  const value = useMemo<ExtensionEditorValue>(
    () => ({
      extension,
      draft,
      readOnly: !canEdit || extension.status !== "active",
      saveState,
      set,
      flush: save,
      retry: () => void save(),
    }),
    [extension, draft, canEdit, saveState, set, save],
  );

  return <ExtensionEditorContext value={value}>{children}</ExtensionEditorContext>;
}

export function useExtensionEditor(): ExtensionEditorValue {
  const value = use(ExtensionEditorContext);

  if (!value) throw new Error("useExtensionEditor needs an ExtensionEditorProvider");

  return value;
}
