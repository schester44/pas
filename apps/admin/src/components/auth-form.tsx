import { AuthHeader } from "@pas/ui/components/auth-layout";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import type * as React from "react";
import { useState } from "react";
import { authClient } from "@/lib/auth";

export type AuthMode = "sign-in" | "sign-up";

export function AuthForm({
  initialMode = "sign-in",
  titles,
  onSuccess,
}: {
  initialMode?: AuthMode;
  titles: Record<AuthMode, { title: string; description?: React.ReactNode }>;
  onSuccess: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
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

    if (result.error) {
      setPending(false);
      setError(result.error.message ?? "Something went wrong. Try again.");

      return;
    }

    await onSuccess();
    setPending(false);
  }

  return (
    <>
      <AuthHeader title={titles[mode].title} description={titles[mode].description} />
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
