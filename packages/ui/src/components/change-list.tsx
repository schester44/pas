import { plainDate } from "../lib/policy-change";

export interface ChangeLike {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface RerollLike {
  transactionId: string;
  effectiveDate: string;
  label: string;
  changes: ChangeLike[];
  conflicts: {
    path: string;
    label: string;
    ours: unknown;
    theirs: unknown;
    outcome: "theirs_from_date" | "no_longer_applies";
  }[];
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "Removed";

  if (typeof value === "string" || typeof value === "number") return String(value);

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) return `${value.length} listed`;

  const address = value as { line1?: string; city?: string };

  return address.line1 ? `${address.line1}, ${address.city}` : "Updated";
}

const changeText = (c: ChangeLike) =>
  c.before === null || c.before === undefined
    ? valueText(c.after)
    : `${valueText(c.before)} → ${valueText(c.after)}`;

/** What an endorsement changes, and for an out-of-sequence one, the later changes it re-rates. */
function ChangeList({ changes, reroll = [] }: { changes: ChangeLike[]; reroll?: RerollLike[] }) {
  return (
    <div className="grid gap-3">
      {changes.length > 0 && (
        <ul className="m-0 grid list-none gap-2 rounded-lg bg-muted/50 p-3 text-sm">
          {changes.map((c) => (
            <li key={c.path} className="grid gap-0.5">
              <span className="font-medium">{c.label}</span>
              <span className="text-muted-foreground tabular-nums">{changeText(c)}</span>
            </li>
          ))}
        </ul>
      )}
      {reroll.map((segment) => (
        <div key={segment.transactionId} className="grid gap-1.5 text-sm">
          <p className="m-0 flex items-center gap-2 font-medium">
            <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
            Also re-rates the {segment.label}
          </p>
          <p className="m-0 pl-3.5 text-muted-foreground">
            Its changes are re-applied on top of this one from {plainDate(segment.effectiveDate)}.
          </p>
          {segment.conflicts.map((c) => (
            <p key={c.path} className="m-0 pl-3.5">
              <span className="font-medium">{c.label}</span>{" "}
              <span className="text-muted-foreground">
                {c.outcome === "no_longer_applies"
                  ? "no longer applies"
                  : `is ${valueText(c.theirs)} from ${plainDate(segment.effectiveDate)}: the later change wins`}
              </span>
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

export { ChangeList };
