import { loadSession } from "@pas/auth/client";
import { AuthLayout } from "@pas/ui/components/auth-layout";
import { Brand } from "@pas/ui/components/brand";
import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CreditCard, FileCheck2, PenLine } from "lucide-react";
import { ClientApplication } from "@/components/apply/client-application";
import { ClientSignIn } from "@/components/client-sign-in";
import { authClient } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/apply/$token")({
  component: ApplyPage,
});

const benefits = [
  { icon: <FileCheck2 />, title: "Review your coverage", body: "See what your agent prepared." },
  { icon: <PenLine />, title: "Sign online", body: "Type your name to sign. It takes a minute." },
  {
    icon: <CreditCard />,
    title: "Pay securely",
    body: "Card details go straight to the processor.",
  },
];

const CLOSED: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This link isn't valid",
    body: "Check that you used the whole link from your agent's email.",
  },
  revoked: {
    title: "This link was replaced",
    body: "Your agent sent a newer link. Use the latest email from them.",
  },
  expired: {
    title: "This link has expired",
    body: "The quote is no longer valid. Ask your agent to send a new one.",
  },
};

/** Where an insured finishes the application their agent sent: verify by email code, then their steps. */
function ApplyPage() {
  const { token } = Route.useParams();
  const trpc = useTRPC();
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const peek = useQuery(trpc.clientApplication.peek.queryOptions({ token }));
  const session = useQuery({ queryKey: ["session"], queryFn: () => loadSession(authClient) });

  if (peek.isPending || session.isPending) return <div className="min-h-svh bg-canvas" />;

  const closed = peek.data ? CLOSED[peek.data.status] : CLOSED.invalid;

  if (closed || peek.error) {
    return (
      <Centered brand={tenant}>
        <Notice title={closed?.title ?? "Couldn't open this link"}>
          {closed?.body ?? "Refresh the page to try again."}
        </Notice>
      </Centered>
    );
  }

  const status = peek.data!;

  if (!session.data) {
    return (
      <AuthLayout
        headline="Finish your application."
        subline={"agent" in status ? `${status.agent} prepared it for you.` : ""}
        benefits={benefits}
        brandName={tenant?.displayName}
        brandLogoUrl={tenant?.logoUrl}
      >
        <ClientSignIn
          title="Confirm it's you"
          description={
            "emailHint" in status ? (
              <>
                Use the email your agent sent this to (
                <span className="font-medium text-foreground">{status.emailHint}</span>) and we'll
                send you a code.
              </>
            ) : undefined
          }
          onSignedIn={() => queryClient.invalidateQueries({ queryKey: ["session"] })}
        />
      </AuthLayout>
    );
  }

  return (
    <div className="min-h-svh bg-canvas">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-6 px-4 sm:px-6">
          <Brand name={tenant?.displayName} logoUrl={tenant?.logoUrl} />
          <span className="truncate text-sm text-muted-foreground">{session.data.user.email}</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
        <ClientApplication
          token={token}
          onWrongAccount={async () => {
            await authClient.signOut();
            queryClient.clear();
          }}
        />
      </main>
    </div>
  );
}

function Centered({
  brand,
  children,
}: {
  brand: ReturnType<typeof useTenant>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-canvas px-4">
      <div className="grid w-full max-w-md gap-6">
        <Brand name={brand?.displayName} logoUrl={brand?.logoUrl} />
        {children}
        <Button variant="outline" asChild>
          <Link to="/portal">Go to your policies</Link>
        </Button>
      </div>
    </div>
  );
}
