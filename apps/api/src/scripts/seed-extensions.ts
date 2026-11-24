// Seeds a demo extension for Homeowners Coastal: roof and coast checks with a policy panel,
// published with its tests, and bound to the product's open draft version if there is one.
// Idempotent: an existing extension with the key is left alone.
import { asId, type TenantContext } from "@pas/kernel";
import { compose } from "../composition";

const TENANT_SLUG = "acme-mga";
const PRODUCT_NAME = "Homeowners Coastal";
const KEY = "roof-and-coast-checks";

const CODE = `type Location = { roofAge?: number; distanceToCoast?: number };
type Input = { risk: { locations?: Location[] } };

const locations = (input: Input) => input.risk.locations ?? [];

export async function validate(input: Input) {
  const old = locations(input).findIndex((l) => (l.roofAge ?? 0) > 40);

  return {
    issues: old === -1 ? [] : [{ path: \`locations[\${old}].roofAge\`, message: "Roofs older than 40 years can't be written" }],
  };
}

export async function underwrite(input: Input) {
  const near = locations(input).some((l) => (l.distanceToCoast ?? 99) < 2);

  return {
    outcomes: near
      ? [{ outcome: "refer", reasonCode: "COAST_UNDER_2MI", message: "A location is within 2 miles of the coast" }]
      : [],
  };
}

export async function recordPanel(input: { record: { risk: Input["risk"] } }) {
  const all = input.record.risk.locations ?? [];
  const oldest = Math.max(0, ...all.map((l) => l.roofAge ?? 0));
  const closest = Math.min(99, ...all.map((l) => l.distanceToCoast ?? 99));

  return {
    blocks: [
      {
        type: "fields",
        items: [
          { label: "Locations", value: String(all.length) },
          { label: "Oldest roof", value: \`\${oldest} years\` },
          { label: "Closest to coast", value: \`\${closest} miles\` },
        ],
      },
      closest < 2
        ? { type: "status", label: "Coastal", tone: "warning", detail: "Wind mitigation applies" }
        : { type: "status", label: "Inland", tone: "success" },
    ],
  };
}
`;

const risk = (location: Record<string, number>) => ({ risk: { locations: [location] } });

const TESTS = [
  {
    id: "validate-old-roof",
    name: "A 45-year roof is refused",
    point: "validate",
    input: risk({ roofAge: 45 }),
    expected: {
      issues: [
        {
          path: "locations[0].roofAge",
          message: "Roofs older than 40 years can't be written",
          severity: "error",
        },
      ],
    },
    network: [],
  },
  {
    id: "underwrite-coast",
    name: "A location a mile from the coast is referred",
    point: "underwrite",
    input: risk({ distanceToCoast: 1 }),
    network: [],
  },
  {
    id: "panel",
    name: "The panel summarizes the locations",
    point: "record_panel",
    input: { record: risk({ roofAge: 12, distanceToCoast: 30 }) },
    network: [],
  },
];

const container = compose();
await container.clocks.start();
const { prisma, extensions } = container;
const uc = container.useCases;

const tenant = await prisma.organization.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

const owner = await prisma.member.findFirstOrThrow({
  where: { organizationId: tenant.id, role: "owner" },
});

const ctx: TenantContext = {
  tenantId: asId(tenant.id),
  actor: { type: "user", userId: asId(owner.userId) },
};

async function seed(): Promise<string> {
  if ((await extensions.list(ctx)).some((e) => e.key === KEY)) return `${KEY} already exists`;

  const created = await extensions.create(ctx, {
    key: KEY,
    name: "Roof and coast checks",
    description:
      "Refuses very old roofs, refers coastal locations and summarizes them on the policy.",
  });

  await extensions.update(ctx, {
    id: created.id,
    draft: {
      files: { "index.ts": CODE },
      manifest: {
        points: ["validate", "underwrite", "record_panel"],
        services: [],
        allowedHosts: [],
        credentials: [],
        liveInSandbox: false,
        limits: {},
      },
      tests: TESTS as never,
    },
  });

  const { version } = await extensions.publish(ctx, { id: created.id, note: "Demo" });

  const product = await prisma.product.findFirst({
    where: { tenantId: tenant.id, name: PRODUCT_NAME },
  });

  const draft = product
    ? await prisma.productVersion.findFirst({
        where: { tenantId: tenant.id, productId: product.id, status: "DRAFT" },
        orderBy: { createdAt: "desc" },
      })
    : null;

  if (!draft) return `${KEY} v${version.version} published; no ${PRODUCT_NAME} draft to bind it to`;

  const current = await uc.catalog.getVersion(ctx, { id: draft.id });

  await uc.catalog.updateVersion(ctx, {
    id: draft.id,
    extensions: [
      ...current.extensions,
      { id: `${KEY}-validate`, point: "validate", extensionVersionId: version.id },
      { id: `${KEY}-underwrite`, point: "underwrite", extensionVersionId: version.id },
      {
        id: `${KEY}-panel`,
        point: "record_panel",
        extensionVersionId: version.id,
        record: "policy",
        label: "Roof and coast",
      },
    ],
  });

  return `${KEY} v${version.version} published and bound to ${PRODUCT_NAME} ${draft.version} (draft)`;
}

console.log(await seed());
process.exit(0);
