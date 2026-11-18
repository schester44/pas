import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";

/** Self-claim: the policy number and the mailing ZIP code on the policy. */
export function ClaimForm({ onLinked }: { onLinked?: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [policyNumber, setPolicyNumber] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [miss, setMiss] = useState<number | null>(null);
  const verify = useMutation(trpc.client.claim.verify.mutationOptions());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setMiss(null);

    verify.mutate(
      { policyNumber, postalCode },
      {
        onSuccess: (result) => {
          if (result.status === "no_match") {
            setMiss(result.attemptsLeft);

            return;
          }

          setPolicyNumber("");
          setPostalCode("");
          void queryClient.invalidateQueries({ queryKey: trpc.client.pathKey() });
          onLinked?.();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="grid gap-2">
          <Label htmlFor="claim-number">Policy number</Label>
          <Input
            id="claim-number"
            value={policyNumber}
            onChange={(e) => setPolicyNumber(e.target.value.toUpperCase())}
            placeholder="POL-0000000"
            autoComplete="off"
            className="tabular-nums"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="claim-zip">Mailing ZIP code</Label>
          <Input
            id="claim-zip"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
            className="tabular-nums"
            required
          />
        </div>
      </div>
      {miss !== null && (
        <Notice tone="error" title="We couldn't match that policy">
          Check the number on your documents and the ZIP code they're mailed to.{" "}
          {miss > 0 && `${miss} ${miss === 1 ? "try" : "tries"} left this hour.`}
        </Notice>
      )}
      {verify.error && (
        <Notice tone="error" title="Couldn't check that policy">
          {verify.error.message}
        </Notice>
      )}
      <div>
        <Button
          type="submit"
          disabled={
            verify.isPending || policyNumber.trim().length < 3 || postalCode.trim().length < 3
          }
        >
          {verify.isPending && <Spinner />}
          Find my policy
        </Button>
      </div>
    </form>
  );
}
