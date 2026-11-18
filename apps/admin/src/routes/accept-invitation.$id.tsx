import { roleLabel } from "@pas/auth/permissions";
import { Brand } from "@pas/ui/components/brand";
import { Button } from "@pas/ui/components/button";
import { Card, CardContent } from "@pas/ui/components/card";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import type * as React from "react";
import { AuthForm } from "@/components/auth-form";
import { authClient } from "@/lib/auth";
import { unwrap } from "@/lib/organization";
import { queryClient } from "@/lib/trpc";

export const Route = createFileRoute("/accept-invitation/$id")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();

    return { session: data };
  },
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const router = useRouter();
  const { session } = Route.useRouteContext();

  return (
    <div className="flex min-h-svh flex-col items-center bg-canvas px-6 py-16">
      <Brand className="mb-10" />
      <div className="w-full max-w-md">
        {session ? (
          <InvitationCard email={session.user.email} />
        ) : (
          <Card>
            <CardContent>
              <AuthForm
                initialMode="sign-up"
                titles={{
                  "sign-up": {
                    title: "Join your team",
                    description: "Create an account with the email your invite was sent to.",
                  },
                  "sign-in": {
                    title: "Join your team",
                    description: "Sign in with the email your invite was sent to.",
                  },
                }}
                onSuccess={() => router.invalidate()}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InvitationCard({ email }: { email: string }) {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();

  const invitation = useQuery({
    queryKey: ["invitation", id, email],
    queryFn: () =>
      unwrap(
        authClient.organization.getInvitation({ query: { id } }),
        "This invitation isn't valid any more.",
      ),
  });

  const accept = useMutation({
    mutationFn: async () => {
      const result = await unwrap(
        authClient.organization.acceptInvitation({ invitationId: id }),
        "Couldn't accept the invitation.",
      );

      await authClient.organization.setActive({ organizationId: result.invitation.organizationId });
    },
    onSuccess: async () => {
      queryClient.clear();
      await navigate({ to: "/" });
    },
  });

  async function switchAccount() {
    await authClient.signOut();
    await router.invalidate();
  }

  if (invitation.isPending) {
    return (
      <InvitationShell title="Join your team">
        <div className="h-20" />
      </InvitationShell>
    );
  }

  if (invitation.error) {
    return (
      <InvitationShell title="Invitation unavailable">
        <p className="m-0 text-sm text-muted-foreground">
          It may have expired, been cancelled, or been sent to a different email than {email}. Ask
          for a new invite, or sign in with the invited email.
        </p>
        <Button variant="outline" className="w-full" onClick={switchAccount}>
          Use a different account
        </Button>
      </InvitationShell>
    );
  }

  const { organizationName, inviterEmail, role } = invitation.data;

  return (
    <InvitationShell title={`Join ${organizationName}`}>
      <p className="m-0 text-sm text-muted-foreground">
        {inviterEmail} invited you to join as {roleLabel(role)}.
      </p>
      {accept.error && <Notice tone="error">{accept.error.message}</Notice>}
      <div className="grid gap-2">
        <Button
          size="lg"
          className="w-full"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending && <Spinner />}
          Accept invitation
        </Button>
        <p className="m-0 text-center text-sm text-muted-foreground">
          Not {email}?{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={switchAccount}
          >
            Switch account
          </button>
        </p>
      </div>
    </InvitationShell>
  );
}

function InvitationShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="grid gap-6">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        {children}
      </CardContent>
    </Card>
  );
}
