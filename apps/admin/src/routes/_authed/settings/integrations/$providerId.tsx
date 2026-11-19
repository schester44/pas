import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, ExternalLink, History } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { CATEGORIES, CertifiedMark, InstallState, ProviderLogo } from "@/components/integrations";
import { formatDateTime } from "@/lib/environment";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/integrations/$providerId")({
  component: IntegrationPage,
});

type Integration = AdminOutputs["integrations"]["get"];
type HealthCheck = AdminOutputs["integrations"]["test"];

function IntegrationPage() {
  const { providerId } = Route.useParams();
  const trpc = useTRPC();
  const integration = useQuery(trpc.integrations.get.queryOptions({ providerId }));

  return (
    <>
      <PageHeader
        title={integration.data?.name ?? "Integration"}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings/integrations">
                <ArrowLeft /> All integrations
              </Link>
            </Button>
            {integration.data && <StatusAction integration={integration.data} />}
          </>
        }
      />
      <PageBody className="max-w-6xl">
        {integration.error ? (
          <Notice tone="error" title="Couldn't load this integration">
            {integration.error.message}
          </Notice>
        ) : integration.data ? (
          <Detail integration={integration.data} />
        ) : (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        )}
      </PageBody>
    </>
  );
}

function useRefresh(providerId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.integrations.get.queryKey({ providerId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.integrations.list.queryKey() }),
    ]);
}

function StatusAction({ integration }: { integration: Integration }) {
  const trpc = useTRPC();
  const refresh = useRefresh(integration.id);

  const setStatus = useMutation(
    trpc.integrations.setStatus.mutationOptions({ onSettled: () => refresh() }),
  );

  if (integration.builtin || !integration.install) return null;

  const enabled = integration.install.status !== "disabled";

  return (
    <Button
      size="sm"
      variant={enabled ? "outline" : "default"}
      disabled={setStatus.isPending}
      title={setStatus.error?.message}
      onClick={() => setStatus.mutate({ providerId: integration.id, enabled: !enabled })}
    >
      {setStatus.isPending && <Spinner />}
      {enabled ? "Disable" : "Enable"}
    </Button>
  );
}

function Detail({ integration }: { integration: Integration }) {
  const category = CATEGORIES[integration.category];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 gap-6">
        <Panel>
          <div className="grid gap-5">
            <div className="flex items-start gap-4">
              <ProviderLogo logo={integration.logo} size="lg" />
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="m-0 text-base leading-6 font-semibold">{integration.name}</p>
                  <InstallState integration={integration} />
                </div>
                <p className="m-0 text-sm text-muted-foreground">{integration.summary}</p>
              </div>
            </div>
            <p className="m-0 text-sm">{integration.description}</p>
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
              {integration.capabilities.map((capability) => (
                <li key={capability} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 shrink-0 text-primary" />
                  {capability}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        {integration.supplies.length > 0 && (
          <Panel
            title="Supplies"
            description="Pick it for these kinds of data in a product's enrichment plan."
          >
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {integration.supplies.map((capability) => (
                <li key={capability} className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                  {capability}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <SetupPanel integration={integration} />
        {integration.webhook && <WebhookPanel webhook={integration.webhook} />}
        {!integration.builtin && <ActivityPanel activity={integration.activity} />}
      </div>
      <aside className="grid gap-6">
        <Panel title="Powers">
          <div className="grid gap-4 text-sm">
            <div className="grid gap-1">
              <p className="m-0 font-medium">{category?.label}</p>
              <p className="m-0 text-muted-foreground">{category?.port}</p>
              {integration.category === "agency_downloads" && (
                <Link
                  to="/distribution/downloads"
                  className="font-medium text-primary hover:underline"
                >
                  Open downloads
                </Link>
              )}
            </div>
            <div className="grid gap-1">
              <p className="m-0 text-xs text-muted-foreground">
                {integration.poweredBy.length > 1 ? "Active now, in order" : "Active now"}
              </p>
              {integration.poweredBy.length === 0 ? (
                <p className="m-0 text-muted-foreground">Nothing yet</p>
              ) : (
                integration.poweredBy.map((provider) => (
                  <p key={provider.id} className="m-0 font-medium">
                    {provider.id === integration.id ? (
                      provider.name
                    ) : (
                      <Link
                        to="/settings/integrations/$providerId"
                        params={{ providerId: provider.id }}
                        className="hover:underline"
                      >
                        {provider.name}
                      </Link>
                    )}
                  </p>
                ))
              )}
            </div>
          </div>
        </Panel>
        <Panel title="Details">
          <dl className="m-0 grid gap-3 text-sm">
            <Fact label="Made by">{integration.vendor}</Fact>
            <Fact label="Modes">
              {[integration.testMode && "Test", integration.liveMode && "Live"]
                .filter(Boolean)
                .join(" and ")}
            </Fact>
            {integration.requiresCredentials && <Fact label="Access">Vendor account required</Fact>}
            {integration.certified && (
              <Fact label="Review">
                <CertifiedMark />
              </Fact>
            )}
            {integration.docsUrl && (
              <Fact label="Docs">
                <a
                  href={integration.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Provider docs <ExternalLink className="size-3.5" />
                </a>
              </Fact>
            )}
          </dl>
        </Panel>
      </aside>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right">{children}</dd>
    </div>
  );
}

type Values = Record<string, unknown>;

function initialValues(integration: Integration): Values {
  return Object.fromEntries(
    integration.configFields.map((field) => [
      field.key,
      integration.config[field.key] ??
        field.defaultValue ??
        (field.type === "boolean" ? false : ""),
    ]),
  );
}

function SetupPanel({ integration }: { integration: Integration }) {
  const trpc = useTRPC();
  const refresh = useRefresh(integration.id);

  const [environment, setEnvironment] = useState<"test" | "live">(
    integration.install?.environment ?? (integration.testMode ? "test" : "live"),
  );

  const [values, setValues] = useState<Values>(() => initialValues(integration));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<HealthCheck | null>(null);
  const formId = React.useId();

  const configure = useMutation(
    trpc.integrations.configure.mutationOptions({
      onSuccess: async () => {
        setSecrets({});
        await refresh();
      },
    }),
  );

  const test = useMutation(
    trpc.integrations.test.mutationOptions({
      onSuccess: async (result) => {
        setCheck(result);
        await refresh();
      },
    }),
  );

  if (integration.builtin) {
    return (
      <Panel title="Setup">
        <p className="m-0 text-sm text-muted-foreground">
          Nothing to set up. It powers {CATEGORIES[integration.category]?.label.toLowerCase()}{" "}
          whenever no other provider is enabled, and always in sandboxes when a provider has no test
          mode.
        </p>
      </Panel>
    );
  }

  const badFields = new Set(
    ((configure.error?.data as { details?: { fields?: string[] } } | undefined)?.details?.fields ??
      []) as string[],
  );

  const liveLocked = integration.sandbox || !integration.liveMode;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setCheck(null);

    const config = Object.fromEntries(
      integration.configFields
        .map((field) => [field.key, coerce(field.type, values[field.key])] as const)
        .filter(([, value]) => value !== undefined),
    );

    configure.mutate({ providerId: integration.id, environment, config, secrets });
  }

  const latest = check ?? integration.health;

  return (
    <Panel
      title="Setup"
      description={`Connect your ${integration.vendor} account.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!integration.install || test.isPending || configure.isPending}
            onClick={() => test.mutate({ providerId: integration.id })}
          >
            {test.isPending && <Spinner />}
            Test connection
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={configure.isPending}>
            {configure.isPending && <Spinner />}
            Save settings
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="grid gap-5">
        <div className="grid gap-2">
          <Label>Mode</Label>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Mode"
              value={environment}
              onValueChange={setEnvironment}
              options={[
                { value: "test", label: "Test", disabled: !integration.testMode },
                { value: "live", label: "Live", disabled: liveLocked },
              ]}
            />
            <span className="text-xs text-muted-foreground">
              {integration.sandbox
                ? "Sandboxes use test mode only."
                : !integration.testMode
                  ? "No test mode; sandboxes use the built-in provider instead."
                  : environment === "test"
                    ? "Test mode: no money moves and nothing is delivered."
                    : "Live mode: real payments and deliveries."}
            </span>
          </div>
        </div>
        {integration.configFields.map((field) => (
          <ConfigField
            key={field.key}
            field={field}
            value={values[field.key]}
            invalid={badFields.has(field.key)}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
          />
        ))}
        {integration.secrets.map((secret) => (
          <div key={secret.key} className="grid gap-2">
            <Label htmlFor={`secret-${secret.key}`}>
              {secret.label}{" "}
              {secret.optional && (
                <span className="font-normal text-muted-foreground">optional</span>
              )}
            </Label>
            <Input
              id={`secret-${secret.key}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              placeholder={secret.hint ?? ""}
              value={secrets[secret.key] ?? ""}
              onChange={(e) =>
                setSecrets((current) => ({ ...current, [secret.key]: e.target.value }))
              }
            />
            <p className="m-0 text-xs text-muted-foreground">
              {secret.hint
                ? `Saved as ${secret.hint}. Enter a new value to replace it.`
                : secret.description}
            </p>
          </div>
        ))}
        {configure.error && (
          <Notice tone="error" title="Couldn't save">
            {configure.error.message}
          </Notice>
        )}
        {test.error && (
          <Notice tone="error" title="Couldn't test the connection">
            {test.error.message}
          </Notice>
        )}
        {configure.isSuccess && !configure.isPending && !check && (
          <p className="m-0 text-sm text-muted-foreground">Settings saved.</p>
        )}
        {latest && <HealthLine health={latest} />}
      </form>
    </Panel>
  );
}

function HealthLine({ health }: { health: { ok: boolean; detail: string; checkedAt: string } }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm" role="status">
      <span
        aria-hidden
        className={cn(
          "mt-1.5 size-1.5 shrink-0 rounded-full",
          health.ok ? "bg-emerald-500" : "bg-red-500",
        )}
      />
      <div className="grid gap-0.5">
        <span className="font-medium">{health.ok ? "Connected" : "Connection failed"}</span>
        <span className="text-muted-foreground">{health.detail}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          Checked {formatDateTime(health.checkedAt)}
        </span>
      </div>
    </div>
  );
}

function coerce(type: string, value: unknown): unknown {
  if (type === "boolean") return Boolean(value);

  if (value === "" || value === null || value === undefined) return undefined;

  if (type === "number") return Number(value);

  return value;
}

function ConfigField({
  field,
  value,
  invalid,
  onChange,
}: {
  field: Integration["configFields"][number];
  value: unknown;
  invalid: boolean;
  onChange: (value: unknown) => void;
}) {
  const id = `config-${field.key}`;

  if (field.type === "boolean") {
    return (
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <div className="grid gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          {field.description && (
            <p className="m-0 text-xs text-muted-foreground">{field.description}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {field.label}{" "}
        {field.optional && <span className="font-normal text-muted-foreground">optional</span>}
      </Label>
      {field.type === "select" ? (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger id={id} aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {field.optionLabels[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
          inputMode={field.type === "url" ? "url" : undefined}
          aria-invalid={invalid}
          spellCheck={false}
          className={cn(field.type === "number" && "tabular-nums")}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {(invalid || field.description) && (
        <p className={cn("m-0 text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
          {invalid ? `Check ${field.label.toLowerCase()}.` : field.description}
        </p>
      )}
    </div>
  );
}

function WebhookPanel({ webhook }: { webhook: { url: string; events: string[] } }) {
  return (
    <Panel title="Webhook" description="Add this endpoint in the provider's dashboard.">
      <div className="grid gap-4">
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={webhook.url}
            className="font-mono text-xs"
            aria-label="Webhook URL"
          />
          <CopyButton value={webhook.url} label="Copy" />
        </div>
        <div className="grid gap-2">
          <p className="m-0 text-xs text-muted-foreground">Events</p>
          <p className="m-0 font-mono text-xs leading-5 text-muted-foreground">
            {webhook.events.join("  ·  ")}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function ActivityPanel({ activity }: { activity: Integration["activity"] }) {
  return (
    <Panel title="Recent activity" flush>
      {activity.length === 0 ? (
        <EmptyState icon={<History />} title="No activity yet" />
      ) : (
        <ul className="m-0 divide-y p-0">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-(--card-p) py-3 text-sm">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  entry.outcome === "ok" ? "bg-emerald-500" : "bg-red-500",
                )}
              />
              <span className="min-w-0 flex-1 break-words">{entry.summary}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDateTime(entry.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
