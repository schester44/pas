import { Notice } from "@pas/ui/components/notice";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTRPC } from "@/lib/trpc";

/** Clearance for staff (PLAN §15.9): which active risks by other producers share a location. */
export function DuplicateRiskNotice({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const clearance = useQuery(trpc.submissions.clearance.queryOptions({ id: submissionId }));
  const result = clearance.data;

  if (!result || result.outcome === "clear") return null;

  return (
    <Notice tone={result.outcome === "block" ? "error" : "warning"} title="Possible duplicate risk">
      <p className="m-0">
        {result.conflicts.length === 1 ? "Another producer has" : "Other producers have"} an active
        risk at this location:{" "}
        {result.conflicts.map((c, i) => (
          <span key={`${c.subjectKind}:${c.subjectId}`}>
            {i > 0 && ", "}
            {c.subjectKind === "policy" ? (
              <Link
                to="/policies/$policyId"
                params={{ policyId: c.subjectId }}
                className="font-medium tabular-nums underline-offset-4 hover:underline"
              >
                {c.label}
              </Link>
            ) : (
              <Link
                to="/submissions/$submissionId"
                params={{ submissionId: c.subjectId }}
                className="font-medium tabular-nums underline-offset-4 hover:underline"
              >
                {c.label}
              </Link>
            )}
            {c.producerName && ` (${c.producerName})`}
          </span>
        ))}
        .
      </p>
    </Notice>
  );
}
