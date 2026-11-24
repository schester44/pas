import { Brand, brandStyle } from "@pas/ui/components/brand";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { CopyableLink } from "@/components/copyable-link";
import { usePermission } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/branding")({
  component: BrandingPage,
});

type Profile = {
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  appSubdomain: string;
  customDomains: string[];
  supportEmail: string | null;
  supportPhone: string | null;
  appUrls: string[];
  updatedAt: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

function BrandingPage() {
  const trpc = useTRPC();
  const profile = useQuery(trpc.tenant.profile.get.queryOptions());

  return (
    <>
      <PageHeader title="Branding" />
      <PageBody className="max-w-6xl">
        {profile.error ? (
          <Notice tone="error" title="Couldn't load branding">
            {profile.error.message}
          </Notice>
        ) : profile.data ? (
          <BrandingForm profile={profile.data} />
        ) : (
          <BrandingSkeleton />
        )}
      </PageBody>
    </>
  );
}

interface FormState {
  displayName: string;
  primaryColor: string;
  logoUrl: string;
  appSubdomain: string;
  customDomains: string[];
  supportEmail: string;
  supportPhone: string;
}

function toFormState(profile: Profile): FormState {
  return {
    displayName: profile.displayName,
    primaryColor: profile.primaryColor,
    logoUrl: profile.logoUrl ?? "",
    appSubdomain: profile.appSubdomain,
    customDomains: profile.customDomains,
    supportEmail: profile.supportEmail ?? "",
    supportPhone: profile.supportPhone ?? "",
  };
}

function BrandingForm({ profile }: { profile: Profile }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canEdit = usePermission({ organization: ["update"] });
  const [initial, setInitial] = useState(() => toFormState(profile));
  const [form, setForm] = useState(initial);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation(
    trpc.tenant.profile.update.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.tenant.profile.get.queryKey(), data);
        setInitial(toFormState(data));
        setForm(toFormState(data));
      },
    }),
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const colorValid = HEX.test(form.primaryColor);
  const previewColor = colorValid ? form.primaryColor.toLowerCase() : initial.primaryColor;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const readOnly = canEdit === false;

  const appBase = profile.appUrls[0]?.replace(`//${profile.appSubdomain}.`, "//") ?? "";
  const baseHost = appBase.replace(/^https?:\/\//, "");
  const previewHost = `${form.appSubdomain || profile.appSubdomain}.${baseHost}`;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (!colorValid || !form.displayName.trim()) return;

    save.mutate({
      displayName: form.displayName,
      primaryColor: form.primaryColor,
      logoUrl: form.logoUrl || null,
      appSubdomain: form.appSubdomain,
      customDomains: form.customDomains,
      supportEmail: form.supportEmail || null,
      supportPhone: form.supportPhone || null,
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]"
    >
      <div className="grid gap-6">
        <Panel title="Brand" description="Shown to agents and customers in the app.">
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
            <Field label="Display name" htmlFor="displayName">
              <Input
                id="displayName"
                value={form.displayName}
                maxLength={120}
                aria-invalid={submitted && !form.displayName.trim()}
                onChange={(event) => set("displayName", event.target.value)}
              />
              {submitted && !form.displayName.trim() && (
                <FieldError>Enter a display name.</FieldError>
              )}
            </Field>
            <Field label="Brand colour" htmlFor="primaryColor">
              <div className="flex gap-2">
                <label className="relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs focus-within:ring-[3px] focus-within:ring-ring/50">
                  <span className="sr-only">Pick a colour</span>
                  <span
                    className="absolute inset-0.5 rounded-[4px]"
                    style={{ background: previewColor }}
                  />
                  <input
                    type="color"
                    value={previewColor}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                    onChange={(event) => set("primaryColor", event.target.value)}
                  />
                </label>
                <Input
                  id="primaryColor"
                  value={form.primaryColor}
                  maxLength={7}
                  spellCheck={false}
                  className="w-32 font-mono tabular-nums"
                  aria-invalid={submitted && !colorValid}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    set("primaryColor", value && !value.startsWith("#") ? `#${value}` : value);
                  }}
                />
              </div>
              {submitted && !colorValid ? (
                <FieldError>Use a hex colour like #0f766e.</FieldError>
              ) : (
                <Hint>
                  Buttons, links and highlights use it. Text on it switches to dark when white isn't
                  readable.
                </Hint>
              )}
            </Field>
            <Field label="Logo URL" optional htmlFor="logoUrl">
              <Input
                id="logoUrl"
                type="url"
                value={form.logoUrl}
                placeholder="https://"
                onChange={(event) => set("logoUrl", event.target.value)}
              />
              <Hint>A square image works best. It's shown at 28px next to your name.</Hint>
            </Field>
          </fieldset>
        </Panel>

        <Panel title="App address" description="Where agents and customers open your app.">
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
            <Field label="Subdomain" htmlFor="appSubdomain">
              <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
                <input
                  id="appSubdomain"
                  value={form.appSubdomain}
                  maxLength={63}
                  spellCheck={false}
                  autoCapitalize="off"
                  className="min-w-0 flex-1 bg-background px-3 text-sm outline-none"
                  onChange={(event) => set("appSubdomain", event.target.value.toLowerCase())}
                />
                <span className="flex items-center border-l bg-muted/50 px-3 text-sm text-muted-foreground">
                  .{baseHost}
                </span>
              </div>
            </Field>
            <CustomDomains
              domains={form.customDomains}
              onChange={(domains) => set("customDomains", domains)}
            />
          </fieldset>
          <div className="mt-6 grid gap-2 border-t pt-4">
            <p className="m-0 text-sm font-medium">Links</p>
            <ul className="m-0 grid list-none gap-1 p-0">
              {profile.appUrls.map((url) => (
                <CopyableLink key={url} url={url} />
              ))}
            </ul>
          </div>
        </Panel>

        <Panel
          title="Support contact"
          description="Shown on the sign-in page so people know who to ask."
          footer={
            <div className="flex items-center justify-end gap-3">
              {save.isSuccess && !dirty && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Check aria-hidden className="size-4 text-emerald-600" /> Saved
                </span>
              )}
              <Button type="submit" disabled={readOnly || !dirty || save.isPending}>
                {save.isPending && <Spinner />}
                Save changes
              </Button>
            </div>
          }
        >
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
            <Field label="Email" optional htmlFor="supportEmail">
              <Input
                id="supportEmail"
                type="email"
                value={form.supportEmail}
                placeholder="support@example.com"
                onChange={(event) => set("supportEmail", event.target.value)}
              />
            </Field>
            <Field label="Phone" optional htmlFor="supportPhone">
              <Input
                id="supportPhone"
                type="tel"
                value={form.supportPhone}
                className="tabular-nums"
                onChange={(event) => set("supportPhone", event.target.value)}
              />
            </Field>
          </fieldset>
          {save.error && (
            <Notice tone="error" title="Couldn't save branding" className="mt-4">
              {save.error.message}
            </Notice>
          )}
          {readOnly && <Notice className="mt-4">Only admins can change branding.</Notice>}
        </Panel>
      </div>

      <div className="xl:sticky xl:top-20">
        <Panel title="Preview" description="The app's sign-in page with these settings.">
          <SignInPreview
            host={previewHost}
            name={form.displayName.trim() || profile.displayName}
            logoUrl={form.logoUrl.trim() || null}
            color={previewColor}
            supportEmail={form.supportEmail.trim()}
          />
        </Panel>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-xs text-muted-foreground">{children}</p>;
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-xs text-destructive">{children}</p>;
}

function CustomDomains({
  domains,
  onChange,
}: {
  domains: string[];
  onChange: (domains: string[]) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const value = draft
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  function add() {
    if (!value || domains.includes(value)) return setDraft("");

    onChange([...domains, value]);
    setDraft("");
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        Custom domains
        <span className="font-normal text-muted-foreground">Optional</span>
      </Label>
      {domains.length > 0 && (
        <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
          {domains.map((domain) => (
            <li key={domain} className="flex h-10 items-center gap-2 pr-1 pl-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{domain}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground"
                aria-label={`Remove ${domain}`}
                onClick={() => onChange(domains.filter((d) => d !== domain))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder="quotes.example.com"
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" disabled={!value} onClick={add}>
          Add domain
        </Button>
      </div>
      <Hint>Point a CNAME record for the domain at your app subdomain, then add it here.</Hint>
    </div>
  );
}

function SignInPreview({
  host,
  name,
  logoUrl,
  color,
  supportEmail,
}: {
  host: string;
  name: string;
  logoUrl: string | null;
  color: string;
  supportEmail: string;
}) {
  return (
    <div
      inert
      aria-hidden
      style={brandStyle(color)}
      className="overflow-hidden rounded-lg border bg-background shadow-(--card-shadow) select-none"
    >
      <div className="flex h-8 items-center justify-center border-b bg-muted/50 px-3">
        <span className="max-w-full truncate rounded-md bg-background px-3 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border">
          {host}
        </span>
      </div>
      <div className="flex aspect-[16/10] text-left">
        <div className="relative flex w-[45%] flex-col justify-between overflow-hidden border-r border-primary/10 bg-linear-to-br from-primary/10 via-primary/5 to-background p-4">
          <div className="pointer-events-none absolute -top-16 -left-16 size-40 rounded-full bg-primary/10 blur-2xl" />
          <Brand
            name={name}
            logoUrl={logoUrl}
            className="relative origin-left scale-[0.8] [&_span]:text-sm"
          />
          <div className="relative grid gap-1.5">
            <p className="m-0 text-base leading-snug font-semibold tracking-tight text-balance">
              Quote, bind and service in one place.
            </p>
            <p className="m-0 text-[11px] text-muted-foreground">
              For agents, brokers and policyholders.
            </p>
          </div>
          <p className="relative m-0 truncate text-[10px] text-muted-foreground">
            {supportEmail ? `Need help? ${supportEmail}` : " "}
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="grid w-full max-w-[200px] gap-2.5">
            <div className="grid gap-0.5">
              <p className="m-0 text-sm font-semibold tracking-tight">Sign in</p>
              <p className="m-0 text-[10px] text-muted-foreground">Welcome back.</p>
            </div>
            <PreviewInput label="Email" />
            <PreviewInput label="Password" />
            <div className="mt-1 flex h-7 items-center justify-center rounded-md bg-primary text-[11px] font-medium text-primary-foreground shadow-xs">
              Sign in
            </div>
            <p className="m-0 text-center text-[10px] text-muted-foreground">
              New here? <span className="font-medium text-primary">Create an account</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewInput({ label }: { label: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-medium">{label}</span>
      <span className="h-6 rounded-[5px] border border-input bg-background shadow-xs" />
    </div>
  );
}

function BrandingSkeleton() {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="grid gap-6">
        {[3, 2, 1].map((rows) => (
          <Panel
            key={rows}
            title={<span className="block h-5 w-28 animate-pulse rounded bg-muted" />}
          >
            <div className="grid gap-4">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="grid gap-2">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                  <div className={cn("h-9 animate-pulse rounded-md bg-muted/60")} />
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
      <Panel title={<span className="block h-5 w-20 animate-pulse rounded bg-muted" />}>
        <div className="aspect-[16/10] animate-pulse rounded-lg bg-muted/60" />
      </Panel>
    </div>
  );
}
