import { AuthHeader, AuthLayout } from "@pas/ui/components/auth-layout";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CreditCard,
  FileCheck2,
  Files,
  Gauge,
  Headset,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { ClientSignIn } from "@/components/client-sign-in";
import { authClient } from "@/lib/auth";
import { type TenantBranding, useTenant } from "@/lib/tenant";

type Audience = "client" | "agent";

const AUDIENCE_KEY = "pas.audience";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { as?: Audience; email?: string } => ({
    ...((search.as === "agent" || search.as === "client") && { as: search.as }),
    ...(typeof search.email === "string" && { email: search.email }),
  }),
  component: LoginPage,
});

const clientBenefits = [
  {
    icon: <Files />,
    title: "Every policy in one place",
    body: "Whichever agent wrote it, it's here.",
  },
  {
    icon: <FileCheck2 />,
    title: "Documents when you need them",
    body: "Declarations, ID cards and notices, ready to download.",
  },
  {
    icon: <CreditCard />,
    title: "Pay in a few taps",
    body: "See what's due and pay by card.",
  },
  {
    icon: <MessageSquare />,
    title: "Ask for a change",
    body: "New address, mortgagee or coverage. Your agent takes it from there.",
  },
];

const agentBenefits = [
  {
    icon: <Gauge />,
    title: "Quote in minutes",
    body: "One form, instant pricing, clear next steps.",
  },
  {
    icon: <ShieldCheck />,
    title: "Bind with confidence",
    body: "See what's needed to bind before you start.",
  },
  {
    icon: <FileCheck2 />,
    title: "Documents when you need them",
    body: "Policies, endorsements and notices in one place.",
  },
  {
    icon: <Headset />,
    title: "Service without the wait",
    body: "Request changes and track them to completion.",
  },
];

function LoginPage() {
  const search = Route.useSearch();
  const tenant = useTenant();

  const [audience, setAudience] = useState<Audience>(
    () => search.as ?? (localStorage.getItem(AUDIENCE_KEY) === "agent" ? "agent" : "client"),
  );

  const choose = (next: Audience) => {
    localStorage.setItem(AUDIENCE_KEY, next);
    setAudience(next);
  };

  const isClient = audience === "client";

  return (
    <AuthLayout
      headline={
        isClient ? "Your insurance, in one place." : "Quote, bind and service in one place."
      }
      subline={
        isClient
          ? "Policies, documents and bills, whoever your agent is."
          : "For agents and brokers."
      }
      benefits={isClient ? clientBenefits : agentBenefits}
      brandName={tenant?.displayName}
      brandLogoUrl={tenant?.logoUrl}
      footnote={tenant && <SupportContact tenant={tenant} />}
    >
      <SegmentedControl
        label="Sign in as"
        value={audience}
        onValueChange={choose}
        options={[
          { value: "client", label: "I'm a client" },
          { value: "agent", label: "I'm an agent" },
        ]}
        className="mb-8 grid w-full grid-cols-2 [&>button]:justify-center"
      />
      {isClient ? <ClientSignIn initialEmail={search.email} /> : <AgentSignIn />}
    </AuthLayout>
  );
}

function AgentSignIn() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignIn = mode === "sign-in";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);

    const result = isSignIn
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: String(form.get("name")) });

    setPending(false);

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.");

      return;
    }

    await navigate({ to: "/" });
  }

  return (
    <>
      <AuthHeader
        title={isSignIn ? "Sign in" : "Create your account"}
        description={isSignIn ? "Welcome back." : "It takes less than a minute."}
      />
      <form onSubmit={onSubmit} className="grid gap-5">
        {!isSignIn && (
          <div className="grid gap-2">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" autoComplete="name" className="h-10" required />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="h-10"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignIn ? "current-password" : "new-password"}
            minLength={8}
            className="h-10"
            required
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner />}
          {isSignIn ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="m-0 mt-6 text-center text-sm text-muted-foreground">
        {isSignIn ? "New here? " : "Already have an account? "}
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          onClick={() => {
            setError(null);
            setMode(isSignIn ? "sign-up" : "sign-in");
          }}
        >
          {isSignIn ? "Create an account" : "Sign in"}
        </button>
      </p>
    </>
  );
}

function SupportContact({ tenant }: { tenant: TenantBranding }) {
  const { supportEmail, supportPhone } = tenant;

  if (!supportEmail && !supportPhone) return null;

  return (
    <p className="m-0">
      Need help?{" "}
      {supportEmail && (
        <a href={`mailto:${supportEmail}`} className="font-medium text-foreground hover:underline">
          {supportEmail}
        </a>
      )}
      {supportEmail && supportPhone && <span aria-hidden> · </span>}
      {supportPhone && (
        <a
          href={`tel:${supportPhone.replace(/[^0-9+]/g, "")}`}
          className="font-medium text-foreground tabular-nums hover:underline"
        >
          {supportPhone}
        </a>
      )}
    </p>
  );
}
