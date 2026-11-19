import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import { EntriesTable, EntrySheet } from "./entry-sheet";

/** The policy's journal entries in the native billing system's ledger. */
export function PolicyLedger({ policyId }: { policyId: string }) {
  const trpc = useTRPC();
  const access = useAccess();
  const [entryId, setEntryId] = useState<string | null>(null);

  const ledger = useQuery({
    ...trpc.ledger.policyLedger.queryOptions({ policyId }),
    enabled: access.billing.read,
  });

  if (!ledger.data?.native) return null;

  return (
    <>
      <EntriesTable
        title="Ledger"
        description="Every journal entry for this policy in the native billing system."
        entries={ledger.data.entries}
        onOpen={setEntryId}
      />
      <EntrySheet
        entryId={entryId}
        onOpen={setEntryId}
        onOpenChange={(open) => !open && setEntryId(null)}
      />
    </>
  );
}
