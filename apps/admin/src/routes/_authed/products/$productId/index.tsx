import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { GitBranch, Plus } from "lucide-react";
import { useState } from "react";
import { availabilitySummary } from "@/components/catalog/availability-summary";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { SkeletonRows } from "@/components/catalog/skeleton-rows";
import { NewVersionDialog } from "@/components/catalog/new-version-dialog";
import { VersionStatus } from "@/components/catalog/version-status";
import { formatDate, formatDateWindow, formatRelative } from "@/lib/format";
import { jurisdictionName, jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/")({
  component: ProductPage,
});

function ProductPage() {
  const { productId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const navigate = Route.useNavigate();
  const product = useQuery(trpc.catalog.products.get.queryOptions({ id: productId }));
  const versions = useQuery(trpc.catalog.versions.list.queryOptions({ productId }));
  const releases = useQuery(trpc.catalog.releases.list.queryOptions({ productId }));
  const [creating, setCreating] = useState(false);

  const newVersion = access.products.write && versions.data && (
    <Button size="sm" onClick={() => setCreating(true)}>
      <Plus /> New version
    </Button>
  );

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="products" to="/products">
                Products
              </Link>,
            ]}
            current={product.data?.name}
          />
        }
        actions={newVersion}
      />
      <PageBody className="max-w-6xl">
        {product.error ? (
          <Notice tone="error" title="Couldn't load this product">
            {product.error.message}
          </Notice>
        ) : (
          <>
            <Panel title="Versions" flush>
              {versions.data?.length === 0 ? (
                <EmptyState
                  icon={<GitBranch />}
                  title="No versions yet"
                  description="A version holds the risk data, forms, coverages and availability you publish."
                  action={
                    access.products.write && (
                      <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                        Create a version
                      </Button>
                    )
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead className="text-right">Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.isPending && <SkeletonRows columns={4} />}
                    {versions.data?.map((version) => (
                      <TableRow
                        key={version.id}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() =>
                          navigate({
                            to: "/products/$productId/versions/$versionId",
                            params: { productId, versionId: version.id },
                          })
                        }
                      >
                        <TableCell>
                          <Link
                            to="/products/$productId/versions/$versionId"
                            params={{ productId, versionId: version.id }}
                            onClick={(event) => event.stopPropagation()}
                            className="font-medium tabular-nums outline-none hover:underline focus-visible:underline"
                          >
                            {version.version}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <VersionStatus status={version.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {availabilitySummary(version.availability) ?? "Not available yet"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatRelative(version.updatedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Panel>

            {releases.data && releases.data.length > 0 && (
              <Panel
                title="Releases"
                description="What quotes and policies resolve to, by jurisdiction and effective date."
                flush
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>New business</TableHead>
                      <TableHead>Renewal</TableHead>
                      <TableHead className="text-right">Published</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {releases.data.map((release) => (
                      <TableRow key={release.id}>
                        <TableCell>
                          <span className="flex items-baseline gap-2">
                            <span className="font-medium">
                              {jurisdictionName(release.jurisdiction)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {jurisdictionShort(release.jurisdiction)}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          <Link
                            to="/products/$productId/versions/$versionId"
                            params={{ productId, versionId: release.productVersionId }}
                            className="hover:underline"
                          >
                            {release.version}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatDateWindow(release.newBusiness)}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatDateWindow(release.renewal)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatDate(release.publishedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            )}
          </>
        )}
      </PageBody>
      {versions.data && (
        <NewVersionDialog
          productId={productId}
          versions={versions.data}
          open={creating}
          onOpenChange={setCreating}
        />
      )}
    </>
  );
}
