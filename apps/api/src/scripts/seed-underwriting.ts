// Seeds the underwriting demo: Homeowners Coastal 2027.7 with referral, subjectivity and inspection
// rules, authority profiles, decline reasons, and Riley Underwriter. Idempotent.
import { asId, newId, type TenantContext } from "@pas/kernel";
import type { UnderwritingSettings } from "@pas/underwriting";
import { compose } from "../composition";

const TENANT_SLUG = "acme-mga";
const PRODUCT_NAME = "Homeowners Coastal";
const BASE_VERSION = "2027.6";
const VERSION = "2027.7";
const NEW_BUSINESS_FROM = "2028-02-01";
const RENEWAL_FROM = "2028-04-01";

const RILEY = {
  email: "riley.uw@example.com",
  password: "password1234",
  name: "Riley Underwriter",
};

const container = compose();
await container.clocks.start();
const { prisma } = container;
const uc = container.useCases;

const tenant = await prisma.organization.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

const owner = await prisma.member.findFirstOrThrow({
  where: { organizationId: tenant.id, role: "owner" },
});

const ctx: TenantContext = {
  tenantId: asId(tenant.id),
  actor: { type: "user", userId: asId(owner.userId) },
};

const table = (
  name: string,
  inputs: { id: string; name: string; field: string }[],
  outputs: { id: string; name: string; field: string }[],
  rules: Record<string, string>[],
) => ({
  nodes: [
    { id: "request", name: "Request", type: "inputNode", position: { x: 80, y: 200 } },
    {
      id: "table",
      name,
      type: "decisionTableNode",
      content: {
        rules: rules.map((rule, i) => ({ _id: `r${i + 1}`, ...rule })),
        inputs,
        outputs,
        hitPolicy: "collect",
      },
      position: { x: 380, y: 200 },
    },
    { id: "response", name: "Response", type: "outputNode", position: { x: 700, y: 200 } },
  ],
  edges: [
    { id: "request-table", type: "edge", sourceId: "request", targetId: "table" },
    { id: "table-response", type: "edge", sourceId: "table", targetId: "response" },
  ],
});

const location = (overrides: Record<string, unknown>) => ({
  address: {
    line1: "41 Lakeshore Drive",
    city: "Evanston",
    region: "IL",
    postalCode: "60201",
    country: "US",
  },
  roofAge: 8,
  yearBuilt: 1996,
  hasSumpPump: true,
  construction: "frame",
  coastalCounty: false,
  distanceToCoast: 30,
  protectionClass: 4,
  ...overrides,
});

const risk = (loc: Record<string, unknown>, quote = { tiv: 405000, writtenPremium: 1500 }) => ({
  market: "non_admitted",
  priorClaims: 0,
  jurisdiction: { country: "US", subdivision: "US-IL" },
  locations: [location(loc)],
  quote,
});

const out = (id: string, name = id) => ({ id, name, field: id });
const roof = { id: "roof", name: "Oldest roof", field: "max(map(locations, #.roofAge))" };

const coast = {
  id: "coast",
  name: "Closest to coast",
  field: "min(map(locations, #.distanceToCoast))",
};

const pc = { id: "pc", name: "Protection class", field: "max(map(locations, #.protectionClass))" };
const tiv = { id: "tiv", name: "Total insured value", field: "quote.tiv" };
const built = { id: "built", name: "Oldest home", field: "min(map(locations, #.yearBuilt))" };

const RULES = [
  {
    kind: "referral_triggers",
    key: "main",
    name: "Underwriter review triggers",
    decision: table(
      "Underwriter review triggers",
      [tiv, built],
      [out("code", "Code"), out("message", "Message"), out("authority", "Authority")],
      [
        {
          tiv: ">= 600000",
          built: "",
          code: '"HIGH_TIV"',
          message: '"Total insured value of $600,000 or more"',
          authority: '"senior_underwriter"',
          _description: "Large homes need a senior review",
        },
        {
          tiv: "",
          built: "< 1950",
          code: '"OLDER_HOME"',
          message: '"Home built before 1950"',
          authority: '"underwriter"',
          _description: "Older wiring and plumbing",
        },
      ],
    ),
    tests: [
      {
        id: "rt-high-tiv",
        name: "A $600,000 dwelling needs a senior underwriter",
        input: risk({}, { tiv: 605000, writtenPremium: 2100 }),
        expected: {
          triggers: [
            {
              code: "HIGH_TIV",
              message: "Total insured value of $600,000 or more",
              authority: "senior_underwriter",
            },
          ],
        },
      },
    ],
  },
  {
    kind: "subjectivities",
    key: "main",
    name: "Homeowners subjectivities",
    decision: table(
      "Homeowners subjectivities",
      [coast, roof, pc],
      [
        out("code", "Code"),
        out("title", "Title"),
        out("timing", "Timing"),
        out("dueDays", "Due days"),
        out("owner", "Owner"),
        out("consequence", "If overdue"),
      ],
      [
        {
          coast: "< 5",
          roof: "",
          pc: "",
          code: '"WIND_MIT"',
          title: '"Signed wind mitigation affidavit"',
          timing: '"post_bind"',
          dueDays: "30",
          owner: '"insured"',
          consequence: '"Consider cancellation for a missing wind mitigation affidavit"',
          _description: "Coastal wind exposure",
        },
        {
          coast: "",
          roof: "> 15",
          pc: "",
          code: '"ROOF_PHOTOS"',
          title: '"Photos of every roof slope"',
          timing: '"post_bind"',
          dueDays: "45",
          owner: '"producer"',
          consequence: "",
          _description: "Ageing roof",
        },
        {
          coast: "",
          roof: "",
          pc: ">= 8",
          code: '"FIRE_LETTER"',
          title: '"Fire department response letter"',
          timing: '"pre_bind"',
          dueDays: "",
          owner: '"producer"',
          consequence: "",
          _description: "Weak fire protection",
        },
      ],
    ),
    tests: [
      {
        id: "sub-coast",
        name: "Near the coast asks for a wind mitigation affidavit",
        input: risk({ distanceToCoast: 3 }),
        expected: {
          subjectivities: [
            {
              code: "WIND_MIT",
              title: "Signed wind mitigation affidavit",
              timing: "post_bind",
              dueDays: 30,
              owner: "insured",
              consequence: "Consider cancellation for a missing wind mitigation affidavit",
            },
          ],
        },
      },
    ],
  },
  {
    kind: "inspection_requirements",
    key: "main",
    name: "Inspection requirements",
    decision: table(
      "Inspection requirements",
      [tiv, roof, coast, pc],
      [out("code", "Code"), out("type", "Type"), out("timing", "Timing"), out("reason", "Reason")],
      [
        {
          tiv: "> 500000",
          roof: "",
          coast: "",
          pc: "",
          code: '"EXT_TIV"',
          type: '"exterior"',
          timing: '"post_bind"',
          reason: '"Total insured value over $500,000"',
          _description: "High value",
        },
        {
          tiv: "",
          roof: "> 20",
          coast: "",
          pc: "",
          code: '"EXT_ROOF"',
          type: '"exterior"',
          timing: '"post_bind"',
          reason: '"Roof older than 20 years"',
          _description: "Roof condition",
        },
        {
          tiv: "",
          roof: "",
          coast: "< 5",
          pc: "",
          code: '"AERIAL_COAST"',
          type: '"aerial"',
          timing: '"post_bind"',
          reason: '"Within 5 miles of the coast"',
          _description: "Wind exposure from imagery",
        },
        {
          tiv: "",
          roof: "",
          coast: "",
          pc: ">= 8",
          code: '"EXT_PC"',
          type: '"exterior"',
          timing: '"pre_bind"',
          reason: '"Protection class 8 or worse"',
          _description: "Weak fire protection",
        },
      ],
    ),
    tests: [
      {
        id: "insp-none",
        name: "A modest inland home needs no inspection",
        input: risk({}),
        expected: { inspections: [] },
      },
      {
        id: "insp-roof",
        name: "An old roof near the coast gets an exterior and an aerial review",
        input: risk({ roofAge: 22, distanceToCoast: 3 }),
        expected: {
          inspections: [
            {
              code: "EXT_ROOF",
              type: "exterior",
              timing: "post_bind",
              reason: "Roof older than 20 years",
            },
            {
              code: "AERIAL_COAST",
              type: "aerial",
              timing: "post_bind",
              reason: "Within 5 miles of the coast",
            },
          ],
        },
      },
    ],
  },
];

const SETTINGS: UnderwritingSettings = {
  authorityProfiles: [
    {
      key: "underwriter",
      name: "Underwriter",
      level: 1,
      maxPremium: "5000",
      maxInsuredValue: "500000",
      products: [],
      jurisdictions: [],
      roles: ["underwriter"],
      userIds: [],
    },
    {
      key: "senior_underwriter",
      name: "Senior underwriter",
      level: 2,
      maxPremium: "10000",
      maxInsuredValue: "1000000",
      products: [],
      jurisdictions: [],
      roles: [],
      userIds: [],
    },
    {
      key: "chief_underwriter",
      name: "Chief underwriter",
      level: 3,
      maxPremium: null,
      maxInsuredValue: null,
      products: [],
      jurisdictions: [],
      roles: ["owner", "tenant_admin"],
      userIds: [],
    },
  ],
  declineReasons: [
    {
      code: "ROOF_CONDITION",
      label: "Roof condition outside our guidelines",
      adverseActionNotice:
        "[Adverse action notice: roof condition. Tenant compliance to supply the jurisdiction's required wording.]",
    },
    {
      code: "WIND_EXPOSURE",
      label: "Wind exposure outside our guidelines",
      adverseActionNotice:
        "[Adverse action notice: coastal wind exposure. Tenant compliance to supply the jurisdiction's required wording.]",
    },
    {
      code: "LOSS_HISTORY",
      label: "Loss history",
      adverseActionNotice:
        "[Adverse action notice: loss history. Name the consumer reporting agency when its report contributed.]",
    },
  ],
  overdueConsequence: "Consider cancellation",
};

async function seedVersion() {
  const product = await prisma.product.findFirstOrThrow({
    where: { tenantId: tenant.id, name: PRODUCT_NAME },
  });

  const versions = await prisma.productVersion.findMany({ where: { productId: product.id } });
  const existing = versions.find((v) => v.version === VERSION);

  if (existing?.status === "PUBLISHED") return `${VERSION} already published`;

  const base = versions.find((v) => v.version === BASE_VERSION && v.status === "PUBLISHED");

  if (!base) throw new Error(`${PRODUCT_NAME} ${BASE_VERSION} isn't published`);

  const draft =
    existing ??
    (await uc.catalog.createVersion(ctx, {
      productId: product.id,
      version: VERSION,
      copyFromId: base.id,
    }));

  const current = await uc.catalog.getVersion(ctx, { id: draft.id });

  const kept = current.rules.filter(
    (r) => !RULES.some((x) => x.kind === r.kind && x.key === r.key),
  );

  await uc.catalog.updateVersion(ctx, {
    id: draft.id,
    rules: [...kept, ...(RULES as unknown as typeof current.rules)],
    availability: current.availability.map((window) => ({
      ...window,
      newBusiness: { from: NEW_BUSINESS_FROM },
      renewal: { from: RENEWAL_FROM },
    })),
  });

  const issues = await uc.catalog.checkVersion(ctx, { id: draft.id });

  if (current.status === "draft") await uc.catalog.submitVersion(ctx, { id: draft.id });

  await uc.catalog.publishVersion(ctx, { id: draft.id });

  return `${VERSION} published (${JSON.stringify(issues).slice(0, 200)})`;
}

async function seedRiley() {
  const found = await prisma.user.findUnique({ where: { email: RILEY.email } });

  const user =
    found ??
    (
      await container.auth.api.signUpEmail({
        body: { email: RILEY.email, password: RILEY.password, name: RILEY.name },
      })
    ).user;

  const sandboxes = await prisma.tenantEnvironment.findMany({
    where: { parentTenantId: tenant.id, kind: "sandbox" },
  });

  for (const organizationId of [tenant.id, ...sandboxes.map((s) => s.tenantId)]) {
    const member = await prisma.member.findFirst({ where: { organizationId, userId: user.id } });

    if (!member) {
      await prisma.member.create({
        data: {
          id: newId(),
          organizationId,
          userId: user.id,
          role: "underwriter",
          createdAt: new Date(),
        },
      });
    }

    const current = await uc.underwriting.settings.get({ ...ctx, tenantId: asId(organizationId) });

    if (current.authorityProfiles.length === 0) {
      await uc.underwriting.settings.update({ ...ctx, tenantId: asId(organizationId) }, SETTINGS);
    }
  }

  return `${RILEY.email} in ${sandboxes.length + 1} organizations`;
}

console.info(await seedVersion());
console.info(await seedRiley());

await container.queues.stop();
await container.workflows.close();
container.clocks.stop();
await prisma.$disconnect();
process.exit(0);
