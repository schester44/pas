import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Check, Copy, Lock } from "lucide-react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { NewVersionDialog } from "@/components/catalog/new-version-dialog";
import { PublishDialog, RetireDialog } from "@/components/catalog/publish-dialog";
import {
  type CheckIssue,
  type ProductVersion,
  useVersionEditor,
  VersionEditorProvider,
} from "@/components/catalog/version-editor";
import { VersionStatus } from "@/components/catalog/version-status";
import { formatDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId")({
  component: VersionLayout,
});

function VersionLayout() {
  const { productId, versionId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const product = useQuery(trpc.catalog.products.get.queryOptions({ id: productId }));
  const version = useQuery(trpc.catalog.versions.get.queryOptions({ id: versionId }));

  const productLink = (
    <Link to="/products/$productId" params={{ productId }}>
      {product.data?.name ?? "Product"}
    </Link>
  );

  if (version.error) {
    return (
      <>
        <PageHeader title={<Breadcrumb parents={[productLink]} current="Version" />} />
        <PageBody className="max-w-6xl">
          <Notice tone="error" title="Couldn't load this version">
            {version.error.message}
          </Notice>
        </PageBody>
      </>
    );
  }

  if (!version.data) {
    return (
      <>
        <PageHeader title={<Breadcrumb parents={[productLink]} />} />
        <div className="h-11 border-b" />
        <PageBody className="max-w-6xl">
          <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
        </PageBody>
      </>
    );
  }

  return (
    <VersionEditorProvider key={versionId} version={version.data} canEdit={access.products.write}>
      <PageHeader
        title={
          <Breadcrumb
            parents={[productLink]}
            current={
              <>
                <span className="truncate tabular-nums">{version.data.version}</span>
                <VersionStatus status={version.data.status} />
              </>
            }
          />
        }
        actions={<VersionActions />}
      />
      <VersionTabs />
      <Outlet />
    </VersionEditorProvider>
  );
}

function VersionActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const access = useAccess();
  const { version, flush, saveState, readOnly } = useVersionEditor();

  const versions = useQuery(
    trpc.catalog.versions.list.queryOptions({ productId: version.productId }),
  );

  const [dialog, setDialog] = useState<"publish" | "copy" | "retire" | null>(null);

  const onSuccess = async (next: ProductVersion) => {
    queryClient.setQueryData(trpc.catalog.versions.get.queryKey({ id: next.id }), next);

    await queryClient.invalidateQueries({
      queryKey: trpc.catalog.versions.list.queryKey({ productId: next.productId }),
    });
  };

  const submit = useMutation(trpc.catalog.versions.submitForReview.mutationOptions({ onSuccess }));
  const reopen = useMutation(trpc.catalog.versions.returnToDraft.mutationOptions({ onSuccess }));
  const error = submit.error ?? reopen.error;

  const copyAction = access.products.write && versions.data && (
    <Button size="sm" onClick={() => setDialog("copy")}>
      <Copy /> Copy to new version
    </Button>
  );

  return (
    <>
      {error && <span className="text-xs text-red-700">{error.message}</span>}
      {version.status === "draft" && !readOnly && <SaveIndicator state={saveState} />}
      {version.status === "draft" && access.products.write && (
        <Button
          size="sm"
          disabled={submit.isPending || saveState === "error"}
          onClick={async () => {
            await flush();
            submit.mutate({ id: version.id });
          }}
        >
          {submit.isPending && <Spinner />}
          Submit for review
        </Button>
      )}
      {version.status === "in_review" && (
        <>
          {access.products.write && (
            <Button
              size="sm"
              variant="outline"
              disabled={reopen.isPending}
              onClick={() => reopen.mutate({ id: version.id })}
            >
              {reopen.isPending && <Spinner />}
              Back to draft
            </Button>
          )}
          {access.products.publish && (
            <Button size="sm" onClick={() => setDialog("publish")}>
              Publish
            </Button>
          )}
        </>
      )}
      {version.status === "published" && (
        <>
          {access.products.publish && (
            <Button size="sm" variant="outline" onClick={() => setDialog("retire")}>
              Retire
            </Button>
          )}
          {copyAction}
        </>
      )}
      {version.status === "retired" && copyAction}

      <PublishDialog
        open={dialog === "publish"}
        onOpenChange={(open) => setDialog(open ? "publish" : null)}
      />
      <RetireDialog
        open={dialog === "retire"}
        onOpenChange={(open) => setDialog(open ? "retire" : null)}
      />
      {versions.data && (
        <NewVersionDialog
          productId={version.productId}
          versions={versions.data}
          copyFromId={version.id}
          open={dialog === "copy"}
          onOpenChange={(open) => setDialog(open ? "copy" : null)}
        />
      )}
    </>
  );
}

function SaveIndicator({ state }: { state: ReturnType<typeof useVersionEditor>["saveState"] }) {
  const { retry } = useVersionEditor();

  if (state === "idle") return null;

  if (state === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-700">
        Couldn't save
        <button
          type="button"
          onClick={retry}
          className="font-medium underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </span>
    );
  }

  return (
    <span
      aria-live="polite"
      className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
    >
      {state === "saving" ? (
        "Saving…"
      ) : (
        <>
          <Check aria-hidden className="size-3.5" /> Saved
        </>
      )}
    </span>
  );
}

const TABS = [
  { to: "/products/$productId/versions/$versionId", label: "Overview", exact: true },
  { to: "/products/$productId/versions/$versionId/risk", label: "Risk data" },
  { to: "/products/$productId/versions/$versionId/questions", label: "Questions" },
  { to: "/products/$productId/versions/$versionId/coverages", label: "Coverages" },
  { to: "/products/$productId/versions/$versionId/rules", label: "Rules" },
  { to: "/products/$productId/versions/$versionId/rating", label: "Rating" },
  { to: "/products/$productId/versions/$versionId/documents", label: "Documents" },
  { to: "/products/$productId/versions/$versionId/billing", label: "Billing" },
  { to: "/products/$productId/versions/$versionId/checks", label: "Checks" },
] as const;

function VersionTabs() {
  const trpc = useTRPC();
  const { version, readOnly } = useVersionEditor();
  const checks = useQuery(trpc.catalog.versions.check.queryOptions({ id: version.id }));
  const params = { productId: version.productId, versionId: version.id };

  return (
    <div className="flex items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
      <nav aria-label="Version" className="-mb-px flex gap-5 overflow-x-auto">
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={params}
            activeOptions={{ exact: "exact" in tab, includeSearch: false }}
            className={cn(
              "flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground",
              "[&.active]:border-primary [&.active]:text-foreground",
            )}
          >
            {tab.label}
            {tab.label === "Checks" && checks.data && <IssueCount issues={checks.data} />}
          </Link>
        ))}
      </nav>
      {readOnly && version.status !== "draft" && (
        <p className="m-0 hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <Lock aria-hidden className="size-3.5" />
          {version.status === "in_review"
            ? "Locked while in review"
            : version.publishedAt
              ? `Published ${formatDate(version.publishedAt)} · read-only`
              : "Read-only"}
        </p>
      )}
    </div>
  );
}

function IssueCount({ issues }: { issues: CheckIssue[] }) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const count = errors || issues.length;

  if (count === 0) return null;

  return (
    <span
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums",
        errors
          ? "bg-red-50 text-red-700 ring-1 ring-red-200"
          : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
      )}
    >
      {count}
    </span>
  );
}
