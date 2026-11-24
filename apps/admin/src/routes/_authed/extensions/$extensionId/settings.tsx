import { EXTENSION_POINTS, POINT_SPECS } from "@pas/extension-points";
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
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { type Manifest, useExtensionEditor } from "@/components/extensions/extension-editor";
import { exportName, SERVICE_LABELS } from "@/components/extensions/labels";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/$extensionId/settings")({
  component: SettingsTab,
});

const SERVICES = Object.keys(SERVICE_LABELS) as Manifest["services"];

function SettingsTab() {
  const { extension, draft, set, readOnly } = useExtensionEditor();
  const manifest = draft.manifest;

  const update = (changes: Partial<Manifest>, immediate = false) =>
    set("manifest", { ...manifest, ...changes }, immediate);

  const togglePoint = (point: Manifest["points"][number], on: boolean) => {
    const points = on ? [...manifest.points, point] : manifest.points.filter((p) => p !== point);

    update(
      {
        points,
        ...(!points.includes("automation") && { services: [] }),
      },
      true,
    );
  };

  return (
    <PageBody className="max-w-4xl">
      <DetailsPanel />
      <Panel
        title="Extension points"
        description="Each point calls the export named after it in index.ts."
      >
        <fieldset disabled={readOnly} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          {EXTENSION_POINTS.map((point) => (
            <label key={point} className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={manifest.points.includes(point)}
                onCheckedChange={(v) => togglePoint(point, v === true)}
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{POINT_SPECS[point].label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {exportName(point)}()
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </Panel>

      {manifest.points.includes("automation") && (
        <Panel
          title="PAS services"
          description="What an automation may ask PAS to do. Each run gets only the services ticked here."
        >
          <fieldset disabled={readOnly} className="m-0 grid gap-3 border-0 p-0">
            {SERVICES.map((service) => (
              <label key={service} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={manifest.services.includes(service)}
                  onCheckedChange={(v) =>
                    update(
                      {
                        services:
                          v === true
                            ? [...manifest.services, service]
                            : manifest.services.filter((s) => s !== service),
                      },
                      true,
                    )
                  }
                />
                <span className="grid gap-0.5">
                  <span>{SERVICE_LABELS[service]}</span>
                  <span className="font-mono text-xs text-muted-foreground">ctx.{service}()</span>
                </span>
              </label>
            ))}
          </fieldset>
        </Panel>
      )}

      <Panel title="Network" description="ctx.fetch reaches these hosts only, over https.">
        <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
          <div className="grid gap-2">
            <Label htmlFor="allowed-hosts">Allowed hosts</Label>
            <Textarea
              id="allowed-hosts"
              rows={4}
              className="font-mono text-xs"
              placeholder={"api.example.com\n*.vendor.com"}
              defaultValue={manifest.allowedHosts.join("\n")}
              onBlur={(e) =>
                update(
                  {
                    allowedHosts: e.target.value
                      .split("\n")
                      .map((h) => h.trim().toLowerCase())
                      .filter(Boolean),
                  },
                  true,
                )
              }
            />
            <p className="m-0 text-xs text-muted-foreground">
              One per line. *.example.com matches its subdomains.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={manifest.liveInSandbox}
              onCheckedChange={(v) => update({ liveInSandbox: v === true }, true)}
            />
            Call the real hosts from sandbox tenants instead of recorded responses
          </label>
        </fieldset>
      </Panel>

      <CredentialsPanel />
      <SecretsPanel extensionId={extension.id} secrets={extension.secrets} />

      <Panel title="Limits" description="Per run. Leave blank for the defaults.">
        <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="limit-memory">Memory (MB)</Label>
              <span className="text-xs text-muted-foreground">Up to 128</span>
            </div>
            <Input
              id="limit-memory"
              type="number"
              min={8}
              max={128}
              placeholder="64"
              className="tabular-nums"
              defaultValue={manifest.limits.memoryMb ?? ""}
              onBlur={(e) =>
                update(
                  {
                    limits: {
                      ...manifest.limits,
                      memoryMb: e.target.value ? Number(e.target.value) : undefined,
                    },
                  },
                  true,
                )
              }
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="limit-cpu">CPU time (ms)</Label>
              <span className="text-xs text-muted-foreground">Up to 2000</span>
            </div>
            <Input
              id="limit-cpu"
              type="number"
              min={10}
              max={2000}
              placeholder="250"
              className="tabular-nums"
              defaultValue={manifest.limits.cpuMs ?? ""}
              onBlur={(e) =>
                update(
                  {
                    limits: {
                      ...manifest.limits,
                      cpuMs: e.target.value ? Number(e.target.value) : undefined,
                    },
                  },
                  true,
                )
              }
            />
          </div>
        </fieldset>
      </Panel>
    </PageBody>
  );
}

function DetailsPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { extension, readOnly } = useExtensionEditor();
  const [name, setName] = useState(extension.name);
  const [description, setDescription] = useState(extension.description ?? "");

  const save = useMutation(
    trpc.extensions.update.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.extensions.get.queryKey({ id: extension.id }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.extensions.list.queryKey() }),
        ]),
    }),
  );

  const dirty = name !== extension.name || description !== (extension.description ?? "");

  return (
    <Panel
      title="Details"
      footer={
        !readOnly && (
          <div className="flex items-center justify-end gap-3">
            {save.error && <span className="text-xs text-red-700">{save.error.message}</span>}
            <Button
              size="sm"
              disabled={!dirty || !name.trim() || save.isPending}
              onClick={() =>
                save.mutate({ id: extension.id, name, description: description || null })
              }
            >
              {save.isPending && <Spinner />}
              Save details
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="details-name">Name</Label>
            <Input id="details-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="details-key">Key</Label>
            <Input id="details-key" value={extension.key} readOnly className="font-mono text-xs" />
          </div>
        </div>
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor="details-description">Description</Label>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <Textarea
            id="details-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </fieldset>
    </Panel>
  );
}

function CredentialsPanel() {
  const { draft, set, readOnly } = useExtensionEditor();
  const manifest = draft.manifest;
  const rules = manifest.credentials;

  const save = (credentials: Manifest["credentials"]) =>
    set("manifest", { ...manifest, credentials });

  return (
    <Panel
      title="Credentials"
      description="Headers PAS adds to requests for a host, filled from secrets. Extension code never sees them."
      action={
        !readOnly && (
          <Button
            size="sm"
            variant="outline"
            disabled={manifest.allowedHosts.length === 0}
            onClick={() =>
              save([
                ...rules,
                {
                  host: manifest.allowedHosts[0] ?? "",
                  header: "authorization",
                  value: "Bearer {{secrets.API_KEY}}",
                },
              ])
            }
          >
            <Plus /> Add header
          </Button>
        )
      }
    >
      {rules.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No headers are added.</p>
      ) : (
        <fieldset disabled={readOnly} className="m-0 grid gap-2 border-0 p-0">
          {rules.map((rule, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_10rem_minmax(0,1.4fr)_auto] gap-2"
            >
              <Select
                value={rule.host}
                onValueChange={(host) => save(rules.map((r, j) => (j === i ? { ...r, host } : r)))}
              >
                <SelectTrigger aria-label="Host">
                  <SelectValue placeholder="Host" />
                </SelectTrigger>
                <SelectContent>
                  {manifest.allowedHosts.map((host) => (
                    <SelectItem key={host} value={host}>
                      {host}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="Header"
                value={rule.header}
                className="font-mono text-xs"
                onChange={(e) =>
                  save(rules.map((r, j) => (j === i ? { ...r, header: e.target.value } : r)))
                }
              />
              <Input
                aria-label="Value"
                value={rule.value}
                className="font-mono text-xs"
                onChange={(e) =>
                  save(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                }
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove header"
                onClick={() => save(rules.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <p className="m-0 text-xs text-muted-foreground">
            Use {"{{secrets.NAME}}"} for a secret below.
          </p>
        </fieldset>
      )}
    </Panel>
  );
}

function SecretsPanel({
  extensionId,
  secrets,
}: {
  extensionId: string;
  secrets: { name: string; hint: string; updatedAt: string }[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { readOnly } = useExtensionEditor();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.extensions.get.queryKey({ id: extensionId }) });

  const put = useMutation(
    trpc.extensions.setSecret.mutationOptions({
      onSuccess: async () => {
        setName("");
        setValue("");
        await refresh();
      },
    }),
  );

  const remove = useMutation(trpc.extensions.removeSecret.mutationOptions({ onSuccess: refresh }));

  return (
    <Panel title="Secrets" description="Sealed when saved and never shown again.">
      <div className="grid gap-4">
        {secrets.length > 0 && (
          <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
            {secrets.map((secret) => (
              <li
                key={secret.name}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="grid gap-0.5">
                  <span className="font-mono text-xs font-medium">{secret.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {secret.hint} · updated {formatDate(secret.updatedAt)}
                  </span>
                </span>
                {!readOnly && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${secret.name}`}
                    onClick={() => remove.mutate({ extensionId, name: secret.name })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <form
            className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              put.mutate({ extensionId, name, value });
            }}
          >
            <Input
              aria-label="Secret name"
              placeholder="API_KEY"
              value={name}
              className="font-mono text-xs"
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              aria-label="Secret value"
              type="password"
              autoComplete="off"
              placeholder="Value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!name.trim() || !value || put.isPending}
            >
              {put.isPending && <Spinner />}
              Save secret
            </Button>
          </form>
        )}
        {put.error && (
          <Notice tone="error" title="Couldn't save the secret">
            {put.error.message}
          </Notice>
        )}
      </div>
    </Panel>
  );
}
