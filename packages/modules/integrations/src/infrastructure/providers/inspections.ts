import type { ClockProvider, Instant, TenantContext } from "@pas/kernel";
import type {
  InspectionAddress,
  InspectionFinding,
  InspectionOrder,
  InspectionProvider,
  InspectionReport,
  InspectionStatusReport,
} from "@pas/underwriting";
import { z } from "zod";
import type { ProviderPackage } from "../../ports/provider-catalog";

const DAY = { hours: 24 } as const;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;

  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

const addressKey = (a: InspectionAddress) =>
  [a.line1, a.line2, a.city, a.region, a.postalCode].join("|").toLowerCase().replace(/\s+/g, " ");

const ROOF = [
  {
    code: "ROOF_GOOD",
    label: "Roof in good condition",
    severity: "info",
    detail: "Shingles intact, no visible granule loss.",
  },
  {
    code: "ROOF_FAIR",
    label: "Roof shows normal wear",
    severity: "minor",
    detail: "Minor granule loss on the south slope.",
  },
  {
    code: "ROOF_WORN",
    label: "Roof worn, nearing end of life",
    severity: "major",
    detail: "Curling shingles and exposed nail heads on two slopes.",
    recommendation: {
      code: "ROOF_CERT",
      title: "Roof certification from a licensed roofer",
      dueDays: 60,
    },
  },
  {
    code: "ROOF_DAMAGE",
    label: "Missing shingles and patched areas",
    severity: "major",
    detail: "Several missing tabs and tarped section over the garage.",
    recommendation: {
      code: "ROOF_REPAIR",
      title: "Proof of roof repair or replacement",
      dueDays: 45,
    },
  },
] as const;

const HAZARDS = [
  {
    code: "TREE_OVERHANG",
    label: "Tree limbs over the roof",
    severity: "minor",
    detail: "Large oak limbs within 3 feet of the roofline.",
    recommendation: {
      code: "TRIM_TREES",
      title: "Trim tree limbs away from the roof",
      dueDays: 30,
    },
  },
  {
    code: "POOL_UNFENCED",
    label: "Pool without a locking fence",
    severity: "major",
    detail: "In-ground pool, no self-latching gate.",
    recommendation: {
      code: "POOL_FENCE",
      title: "Install a fence with a self-latching gate",
      dueDays: 30,
    },
  },
  {
    code: "STEPS_NO_RAIL",
    label: "Front steps without a handrail",
    severity: "minor",
    detail: "Five concrete steps, no handrail.",
    recommendation: {
      code: "HANDRAIL",
      title: "Install a handrail on the front steps",
      dueDays: 30,
    },
  },
  {
    code: "YARD_DEBRIS",
    label: "Debris in the yard",
    severity: "info",
    detail: "Stacked lumber along the side yard.",
  },
] as const;

/** Plausible findings, the same for the same address every time, so demos repeat. */
export function mockReport(type: string, seed: number): InspectionReport {
  const imagery = type === "aerial";
  const source = imagery ? ("imagery" as const) : ("onsite" as const);
  const roof = ROOF[seed % ROOF.length]!;
  const hazards = HAZARDS.filter((_, i) => (seed >> (i + 3)) & 1);

  const findings: InspectionFinding[] = [roof, ...hazards].map((f) => ({ ...f, source }));

  return {
    summary: imagery
      ? `Aerial imagery review: ${roof.label.toLowerCase()}. Imagery needs a person to confirm before any action.`
      : `Exterior inspection completed: ${roof.label.toLowerCase()}, ${hazards.length} other ${hazards.length === 1 ? "finding" : "findings"}.`,
    findings,
    photos: (imagery
      ? ["Roof, overhead"]
      : ["Front elevation", "Roof, south slope", "Rear yard"]
    ).map((caption) => ({ caption, url: null })),
  };
}

interface MockRef {
  orderedAt: Instant;
  seed: number;
  type: string;
}

const encode = (r: MockRef) =>
  `MOCK-${r.orderedAt.epochMilliseconds.toString(36)}-${r.seed.toString(36)}-${r.type}`;

function decode(ref: string): MockRef {
  const [, at, seed, type] = /^MOCK-([0-9a-z]+)-([0-9a-z]+)-([a-z_]+)$/.exec(ref) ?? [];

  if (!at || !seed || !type) throw new Error(`Not a mock inspection reference: ${ref}`);

  return {
    orderedAt: Temporal.Instant.fromEpochMilliseconds(Number.parseInt(at, 36)),
    seed: Number.parseInt(seed, 36),
    type,
  };
}

/**
 * The built-in inspection service: scheduled a day after ordering and completed five days after,
 * in the tenant's time, so sandbox time travel moves it along. Aerial reviews finish in a day.
 */
export function mockInspections(clocks: ClockProvider): InspectionProvider {
  const status = (ctx: TenantContext, r: MockRef): InspectionStatusReport => {
    const now = clocks.forTenant(ctx.tenantId).now();
    const scheduledAt = r.orderedAt.add(DAY);
    const doneAt = r.type === "aerial" ? scheduledAt : r.orderedAt.add({ hours: 24 * 5 });
    const passed = (at: Instant) => Temporal.Instant.compare(now, at) >= 0;

    if (passed(doneAt)) {
      return { status: "completed", completedAt: doneAt, report: mockReport(r.type, r.seed) };
    }

    if (passed(scheduledAt))
      return { status: "scheduled", scheduledFor: doneAt, nextCheckAt: doneAt };

    return { status: "ordered", nextCheckAt: r.type === "aerial" ? doneAt : scheduledAt };
  };

  return {
    provider: "mock_inspections",
    async order(ctx, order: InspectionOrder) {
      const ref: MockRef = {
        orderedAt: clocks.forTenant(ctx.tenantId).now(),
        seed: fnv1a(addressKey(order.address)),
        type: order.type,
      };

      return { providerRef: encode(ref), ...status(ctx, ref) };
    },
    async check(ctx, providerRef) {
      return status(ctx, decode(providerRef));
    },
    async cancel(_ctx, providerRef) {
      decode(providerRef);
    },
  };
}

export function inspectionProviders(clocks: ClockProvider): ProviderPackage<"inspections">[] {
  return [
    {
      manifest: {
        id: "mock_inspections",
        name: "Mock inspections",
        vendor: "Built in",
        category: "inspections",
        summary: "Schedules a day after ordering and reports five days later, in tenant time.",
        description:
          "Stands in for an inspection vendor: orders are scheduled after a day and completed after five days of tenant time (aerial reviews after one), with roof and hazard findings that are the same for the same address. Works with sandbox time travel.",
        capabilities: [
          "Exterior and field inspections",
          "Aerial imagery reviews",
          "Repeatable findings",
        ],
        configSchema: z.object({}),
        secrets: [],
        docsUrl: null,
        logo: { icon: "camera" },
        testMode: true,
        liveMode: true,
        certified: true,
        builtin: true,
        webhook: null,
      },
      create: () => mockInspections(clocks),
      check: async () => ({
        ok: true,
        detail: "The built-in inspection service is always available.",
      }),
    },
  ];
}
