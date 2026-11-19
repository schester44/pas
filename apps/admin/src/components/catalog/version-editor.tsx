import type { AdminOutputs } from "@pas/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc";

export type ProductVersion = AdminOutputs["catalog"]["versions"]["get"];
export type CheckIssue = AdminOutputs["catalog"]["versions"]["check"][number];
export type Coverage = ProductVersion["coverages"][number];
export type AvailabilityWindow = ProductVersion["availability"][number];
export type VersionForm = ProductVersion["forms"][number];
export type VersionDecision = ProductVersion["rules"][number];
export type DecisionTest = VersionDecision["tests"][number];
export type RatingConfig = NonNullable<ProductVersion["rating"]>;
export type BillingConfig = ProductVersion["billing"];
export type PayPlan = BillingConfig["payPlans"][number];

export type Contents = Pick<
  ProductVersion,
  | "riskSchema"
  | "forms"
  | "coverages"
  | "availability"
  | "lifecycle"
  | "documents"
  | "rules"
  | "rating"
  | "billing"
>;

export type SaveState = "idle" | "saving" | "saved" | "error";

interface VersionEditorValue {
  version: ProductVersion;
  contents: Contents;
  readOnly: boolean;
  saveState: SaveState;
  set: <K extends keyof Contents>(key: K, value: Contents[K], immediate?: boolean) => void;
  flush: () => Promise<void>;
  retry: () => void;
}

const VersionEditorContext = createContext<VersionEditorValue | null>(null);

const AUTOSAVE_DELAY = 700;

const pick = (version: ProductVersion): Contents => ({
  riskSchema: version.riskSchema,
  forms: version.forms,
  coverages: version.coverages,
  availability: version.availability,
  lifecycle: version.lifecycle,
  documents: version.documents,
  rules: version.rules,
  rating: version.rating,
  billing: version.billing,
});

export function VersionEditorProvider({
  version,
  canEdit,
  children,
}: {
  version: ProductVersion;
  canEdit: boolean;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [contents, setContents] = useState(() => pick(version));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pending = useRef<Partial<Contents>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);

  const update = useMutation(trpc.catalog.versions.update.mutationOptions());
  const { mutateAsync } = update;

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);

    for (;;) {
      if (inFlight.current) await inFlight.current;

      const changes = pending.current;

      if (Object.keys(changes).length === 0) return;

      pending.current = {};
      setSaveState("saving");

      let failed = false;

      const run = mutateAsync({ id: version.id, ...changes })
        .then(async (saved) => {
          queryClient.setQueryData(trpc.catalog.versions.get.queryKey({ id: version.id }), saved);

          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: trpc.catalog.versions.check.queryKey({ id: version.id }),
            }),
            queryClient.invalidateQueries({
              queryKey: trpc.catalog.versions.list.queryKey({ productId: version.productId }),
            }),
          ]);

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
  }, [mutateAsync, queryClient, trpc, version.id, version.productId]);

  const set = useCallback(
    <K extends keyof Contents>(key: K, value: Contents[K], immediate?: boolean) => {
      setContents((current) => ({ ...current, [key]: value }));
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

  const value = useMemo<VersionEditorValue>(
    () => ({
      version,
      contents,
      readOnly: !canEdit || version.status !== "draft",
      saveState,
      set,
      flush: save,
      retry: () => void save(),
    }),
    [version, contents, canEdit, saveState, set, save],
  );

  return <VersionEditorContext value={value}>{children}</VersionEditorContext>;
}

export function useVersionEditor(): VersionEditorValue {
  const value = use(VersionEditorContext);

  if (!value) throw new Error("useVersionEditor needs a VersionEditorProvider");

  return value;
}
