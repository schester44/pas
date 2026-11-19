import type { AdminOutputs } from "@pas/api-client";
import { Panel } from "@pas/ui/components/panel";
import { Link } from "@tanstack/react-router";
import { KIND_LABELS } from "./labels";

type Integration = AdminOutputs["integrations"]["list"]["integrations"][number];

const KINDS = [
  "sl_filing",
  "sl_affidavit",
  "sl_remittance",
  "bordereau",
  "stat_report",
  "carrier_report",
];

const statesOf = (files: NonNullable<Integration["files"]>) =>
  files.jurisdictions === "all"
    ? "All states"
    : files.jurisdictions.map((j) => j.replace(/^[A-Z]{2}-/, "")).join(", ");

/** Regulatory reporting channels grouped by the obligation kind they file (PLAN §17.5). */
export function RegulatoryCoverage({ integrations }: { integrations: Integration[] }) {
  const rows = KINDS.map((kind) => ({
    kind,
    channels: integrations.filter((i) => i.files?.kinds.includes(kind)),
  })).filter((row) => row.channels.length > 0);

  return (
    <Panel title="By obligation kind" flush>
      <ul className="m-0 list-none divide-y p-0">
        {rows.map((row) => (
          <li
            key={row.kind}
            className="grid gap-1 px-(--card-p) py-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4"
          >
            <span className="text-sm leading-5 font-medium">{KIND_LABELS[row.kind]}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {row.channels.map((c) => (
                <Link
                  key={c.id}
                  to="/settings/integrations/$providerId"
                  params={{ providerId: c.id }}
                  className="text-foreground hover:underline"
                >
                  {c.name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {statesOf(c.files!)}
                    {c.powering ? " · active" : ""}
                  </span>
                </Link>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
