import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Field } from "@/components/distribution/agency-dialog";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/carriers/$carrierId/connections")({
  component: ConnectionsTab,
});

type Connection = AdminOutputs["carriers"]["get"]["connections"][number];
type Auth = Connection["auth"];

const AUTH_LABELS: Record<Auth["kind"], string> = {
  none: "None",
  api_key: "API key",
  basic: "Basic (username and password)",
  oauth2_client_credentials: "OAuth2 client credentials",
  mtls: "Mutual TLS (client certificate)",
};

const SECRETS: Record<
  Auth["kind"],
  {
    field: "apiKey" | "password" | "clientSecret" | "certificate" | "privateKey";
    label: string;
    multiline?: boolean;
  }[]
> = {
  none: [],
  api_key: [{ field: "apiKey", label: "API key" }],
  basic: [{ field: "password", label: "Password" }],
  oauth2_client_credentials: [{ field: "clientSecret", label: "Client secret" }],
  mtls: [
    { field: "certificate", label: "Client certificate (PEM)", multiline: true },
    { field: "privateKey", label: "Private key (PEM)", multiline: true },
  ],
};

function ConnectionsTab() {
  const { carrierId } = Route.useParams();
  const trpc = useTRPC();
  const carrier = useQuery(trpc.carriers.get.queryOptions({ id: carrierId }));

  if (!carrier.data)
    return (
      <PageBody className="max-w-4xl">
        <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
      </PageBody>
    );

  return (
    <PageBody className="max-w-4xl">
      {(["test", "live"] as const).map((environment) => (
        <ConnectionPanel
          key={`${environment}-${carrier.data.connections.find((c) => c.environment === environment)?.updatedAt ?? "new"}`}
          carrierId={carrierId}
          environment={environment}
          active={carrier.data.activeEnvironment === environment}
          connection={carrier.data.connections.find((c) => c.environment === environment) ?? null}
        />
      ))}
    </PageBody>
  );
}

function ConnectionPanel({
  carrierId,
  environment,
  active,
  connection,
}: {
  carrierId: string;
  environment: "test" | "live";
  active: boolean;
  connection: Connection | null;
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");

  const [auth, setAuth] = useState<Auth>(
    connection?.auth ?? { kind: "api_key", header: "x-api-key" },
  );

  const [callback, setCallback] = useState<Connection["callback"]>(
    connection?.callback ?? { signature: "hmac_sha256", header: "x-carrier-signature" },
  );

  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const readOnly = !access.products.write;
  const id = (name: string) => `${environment}-${name}`;

  const save = useMutation(
    trpc.carriers.saveConnection.mutationOptions({
      onSuccess: async () => {
        setSecrets({});

        await queryClient.invalidateQueries({
          queryKey: trpc.carriers.get.queryKey({ id: carrierId }),
        });
      },
    }),
  );

  const kind = (next: Auth["kind"]): Auth =>
    next === "api_key"
      ? { kind: next, header: "x-api-key" }
      : next === "basic"
        ? { kind: next, username: "" }
        : next === "oauth2_client_credentials"
          ? { kind: next, tokenUrl: "", clientId: "" }
          : { kind: next };

  const hint = (field: string) => connection?.secretHints[field as keyof Connection["secretHints"]];

  return (
    <Panel
      title={environment === "test" ? "Test environment" : "Live environment"}
      description={
        environment === "test"
          ? "Sandboxes and the test console always use this one."
          : active
            ? "Production quotes and policies use this one."
            : "Production uses the test environment until the carrier goes live."
      }
      footer={
        !readOnly && (
          <div className="flex items-center justify-end gap-3">
            {save.error && <span className="text-xs text-red-700">{save.error.message}</span>}
            <Button
              size="sm"
              disabled={save.isPending || !baseUrl}
              onClick={() =>
                save.mutate({
                  carrierId,
                  environment,
                  baseUrl,
                  auth,
                  callback,
                  secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== "")),
                })
              }
            >
              {save.isPending && <Spinner />}
              Save connection
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-4">
        <Field label="Base URL" id={id("url")}>
          <Input
            id={id("url")}
            value={baseUrl}
            readOnly={readOnly}
            placeholder="https://api.carrier.com/v1"
            className="font-mono text-xs"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Authentication" id={id("auth")}>
            <Select
              value={auth.kind}
              onValueChange={(v) => setAuth(kind(v as Auth["kind"]))}
              disabled={readOnly}
            >
              <SelectTrigger id={id("auth")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AUTH_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {auth.kind === "api_key" && (
            <Field label="Header" id={id("header")}>
              <Input
                id={id("header")}
                value={auth.header}
                readOnly={readOnly}
                className="font-mono text-xs"
                onChange={(e) => setAuth({ ...auth, header: e.target.value })}
              />
            </Field>
          )}
          {auth.kind === "basic" && (
            <Field label="Username" id={id("username")}>
              <Input
                id={id("username")}
                value={auth.username}
                readOnly={readOnly}
                onChange={(e) => setAuth({ ...auth, username: e.target.value })}
              />
            </Field>
          )}
          {auth.kind === "oauth2_client_credentials" && (
            <>
              <Field label="Token URL" id={id("token")}>
                <Input
                  id={id("token")}
                  value={auth.tokenUrl}
                  readOnly={readOnly}
                  className="font-mono text-xs"
                  onChange={(e) => setAuth({ ...auth, tokenUrl: e.target.value })}
                />
              </Field>
              <Field label="Client id" id={id("client")}>
                <Input
                  id={id("client")}
                  value={auth.clientId}
                  readOnly={readOnly}
                  onChange={(e) => setAuth({ ...auth, clientId: e.target.value })}
                />
              </Field>
              <Field label="Scope" id={id("scope")} optional>
                <Input
                  id={id("scope")}
                  value={auth.scope ?? ""}
                  readOnly={readOnly}
                  onChange={(e) => setAuth({ ...auth, scope: e.target.value || undefined })}
                />
              </Field>
            </>
          )}
        </div>
        {SECRETS[auth.kind].map((secret) => (
          <Field key={secret.field} label={secret.label} id={id(secret.field)}>
            {secret.multiline ? (
              <Textarea
                id={id(secret.field)}
                rows={4}
                readOnly={readOnly}
                className="font-mono text-xs"
                placeholder={
                  hint(secret.field)
                    ? `Saved (${hint(secret.field)}); paste to replace`
                    : "-----BEGIN ..."
                }
                value={secrets[secret.field] ?? ""}
                onChange={(e) => setSecrets({ ...secrets, [secret.field]: e.target.value })}
              />
            ) : (
              <Input
                id={id(secret.field)}
                type="password"
                readOnly={readOnly}
                autoComplete="off"
                placeholder={hint(secret.field) ? `Saved ${hint(secret.field)}` : ""}
                value={secrets[secret.field] ?? ""}
                onChange={(e) => setSecrets({ ...secrets, [secret.field]: e.target.value })}
              />
            )}
          </Field>
        ))}
        <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
          <Field label="Callback signature" id={id("signature")}>
            <Select
              value={callback.signature}
              onValueChange={(v) =>
                setCallback({ ...callback, signature: v as "none" | "hmac_sha256" })
              }
              disabled={readOnly}
            >
              <SelectTrigger id={id("signature")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hmac_sha256">HMAC SHA-256</SelectItem>
                <SelectItem value="none">Not signed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Signature header" id={id("sig-header")}>
            <Input
              id={id("sig-header")}
              value={callback.header}
              readOnly={readOnly}
              className="font-mono text-xs"
              onChange={(e) => setCallback({ ...callback, header: e.target.value })}
            />
          </Field>
          <Field label="Callback secret" id={id("cb-secret")}>
            <Input
              id={id("cb-secret")}
              type="password"
              readOnly={readOnly}
              autoComplete="off"
              placeholder={hint("callbackSecret") ? `Saved ${hint("callbackSecret")}` : ""}
              value={secrets.callbackSecret ?? ""}
              onChange={(e) => setSecrets({ ...secrets, callbackSecret: e.target.value })}
            />
          </Field>
        </div>
        {connection && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <span className="grid min-w-0 gap-0.5">
              <span className="text-xs text-muted-foreground">
                Callback URL to give the carrier
              </span>
              <code className="truncate font-mono text-xs">{connection.callbackUrl}</code>
            </span>
            <CopyButton value={connection.callbackUrl} />
          </div>
        )}
        {!connection && (
          <Notice title="Not set up">
            Save a base URL and credentials to use this environment.
          </Notice>
        )}
      </div>
    </Panel>
  );
}
