import { AuthHeader } from "@pas/ui/components/auth-layout";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { queryClient } from "@/lib/trpc";

/** Email one-time code: enter an email, then the six digits we send to it. */
export function ClientSignIn({
  initialEmail,
  title = "Sign in",
  description = "We'll email you a code. No password needed.",
  onSignedIn,
}: {
  initialEmail?: string;
  title?: string;
  description?: React.ReactNode;
  /** Stay where the client is instead of going to the portal. */
  onSignedIn?: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);

  async function sendCode() {
    const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });

    if (result.error)
      throw new Error(result.error.message ?? "We couldn't send a code. Try again.");
  }

  async function run(work: () => Promise<void>) {
    setPending(true);
    setError(null);

    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  const onEmail = (event: React.FormEvent) => {
    event.preventDefault();

    void run(async () => {
      await sendCode();
      setStep("code");
    });
  };

  const onCode = (event: React.FormEvent) => {
    event.preventDefault();

    void run(async () => {
      const result = await authClient.signIn.emailOtp({ email, otp: code });

      if (result.error) {
        throw new Error("That code didn't work. Check it, or send a new one.");
      }

      queryClient.clear();

      if (onSignedIn) await onSignedIn();
      else await navigate({ to: "/portal" });
    });
  };

  if (step === "code") {
    return (
      <>
        <AuthHeader
          title="Check your email"
          description={
            <>
              We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
              .
            </>
          }
        />
        <form onSubmit={onCode} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="code">Sign-in code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className="h-12 text-center text-lg tracking-[0.4em] tabular-nums"
              required
            />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || code.length !== 6}
          >
            {pending && <Spinner />}
            Sign in
          </Button>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            className="font-medium text-muted-foreground hover:text-foreground"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
          <button
            type="button"
            className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            disabled={pending || resent}
            onClick={() =>
              void run(async () => {
                await sendCode();
                setResent(true);
              })
            }
          >
            {resent ? "Code sent" : "Send a new code"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeader title={title} description={description} />
      <form onSubmit={onEmail} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="client-email">Email</Label>
          <Input
            id="client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-10"
            required
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Spinner />}
          Email me a code
        </Button>
      </form>
    </>
  );
}
