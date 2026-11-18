import { Brand } from "@pas/ui/components/brand";
import { Button } from "@pas/ui/components/button";
import { Card, CardContent } from "@pas/ui/components/card";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { slugify } from "@/lib/format";

export const Route = createFileRoute("/organizations")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();

    if (!data) throw redirect({ to: "/login" });
  },
  component: OrganizationsPage,
});

/** Pick or create the organization (tenant) to work in. */
function OrganizationsPage() {
  const router = useRouter();
  const { data: organizations, isPending } = authClient.useListOrganizations();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function activate(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    await router.navigate({ to: "/" });
  }

  async function onCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    setCreating(true);
    setError(null);
    const result = await authClient.organization.create({ name, slug: slugify(name) });
    setCreating(false);

    if (result.error) {
      setError(result.error.message ?? "Couldn't create the organization. Try another name.");

      return;
    }

    await activate(result.data.id);
  }

  const hasOrganizations = (organizations?.length ?? 0) > 0;

  return (
    <div className="flex min-h-svh flex-col items-center bg-canvas px-6 py-16">
      <Brand className="mb-10" />
      <div className="grid w-full max-w-md gap-6">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
            {hasOrganizations ? "Choose an organization" : "Create your organization"}
          </h1>
          <p className="m-0 text-sm text-muted-foreground">
            Each organization has its own products, policies and team.
          </p>
        </div>

        {hasOrganizations && (
          <Card className="overflow-hidden">
            <ul className="m-0 list-none divide-y p-0">
              {organizations?.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => activate(org.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
                      {org.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{org.name}</span>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!isPending && (
          <Card>
            <CardContent>
              <form onSubmit={onCreate} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">
                    {hasOrganizations ? "New organization" : "Organization name"}
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Acme Specialty MGA"
                    className="h-10"
                    required
                  />
                </div>
                {error && <Notice tone="error">{error}</Notice>}
                <Button
                  type="submit"
                  variant={hasOrganizations ? "outline" : "default"}
                  disabled={creating}
                >
                  {creating && <Spinner />}
                  Create organization
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
