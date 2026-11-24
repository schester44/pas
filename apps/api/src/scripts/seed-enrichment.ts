// Seeds the data enrichment demo: installs Mock data, publishes Homeowners Coastal 2028.2 with a
// replacement cost and hazard enrichment plan and a generated cost report, then quotes it once.
// Idempotent for the version; each run starts a new submission.
import { asId, type TenantContext } from "@pas/kernel";
import { compose } from "../composition";

const TENANT_SLUG = "acme-mga";
const PRODUCT_KEY = "ho3-coastal";
const BASE_VERSION = "2028.1";
const VERSION = "2028.3";
const NEW_BUSINESS_FROM = "2028-09-02";
const RENEWAL_FROM = "2028-11-02";
const FIXTURE_STREET = "12 Harbor Point Rd";

const container = compose();
await container.clocks.start();
const { prisma } = container;
const uc = container.useCases;

const tenant = await prisma.organization.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

const owner = await prisma.member.findFirstOrThrow({
  where: { organizationId: tenant.id, role: "owner" },
  include: { user: true },
});

const ctx: TenantContext = {
  tenantId: asId(tenant.id),
  actor: { type: "user", userId: asId(owner.userId) },
};

const address = (field: string) => `locations[0].address.${field}`;

const ENRICHMENT = {
  stages: {
    pre_rate: [
      {
        id: "hazards",
        capability: "hazard_scores",
        providers: ["hazardhub", "mock_data"],
        request: {
          street: address("line1"),
          city: address("city"),
          state: address("region"),
          postalCode: address("postalCode"),
        },
        response: {},
        mode: "prefill",
        cacheTtl: "P30D",
        costClass: "medium",
      },
      {
        id: "rce",
        capability: "replacement_cost",
        providers: ["e2value", "mock_data"],
        request: {
          street: address("line1"),
          city: address("city"),
          state: address("region"),
          postalCode: address("postalCode"),
          yearBuilt: "locations[0].yearBuilt",
          squareFeet: "locations[0].squareFeet",
        },
        optional: ["yearBuilt", "squareFeet"],
        response: {},
        mode: "prefill",
        cacheTtl: "P30D",
        costClass: "medium",
      },
    ],
  },
  derivations: [
    {
      id: "dwellingValue",
      stage: "pre_rate",
      label: "Dwelling value (rounded)",
      kind: "money",
      expression: "round(call.rce.insurableReplacementCost / 1000) * 1000",
    },
  ],
  mappings: [
    {
      from: "call.hazards.distanceToCoastMiles",
      to: "locations[0].distanceToCoast",
      mode: "prefill",
    },
    { from: "call.hazards.protectionClass", to: "locations[0].protectionClass", mode: "prefill" },
    { from: "call.rce.squareFeet", to: "locations[0].squareFeet", mode: "prefill" },
    { from: "derived.dwellingValue", to: "locations[0].replacementCost", mode: "prefill" },
  ],
  reports: [
    {
      id: "rce_report",
      title: "Replacement cost report",
      stage: "pre_rate",
      source: "vendor_then_template",
      callId: "rce",
      template: "rce_report",
    },
  ],
};

const REPORT_TEMPLATE = {
  key: "rce_report",
  title: "Estimated replacement cost report",
  kind: "enrichment_report",
  page: { size: "letter", margins: "normal" },
  blocks: [
    {
      id: "header",
      type: "header",
      title: "Estimated replacement cost report",
      subtitle: "{{product.name}}",
    },
    {
      id: "building",
      type: "keyValue",
      title: "Building",
      columns: 2,
      rows: [
        { label: "Address", value: "{{risk.locations[0].address}}" },
        { label: "Year built", value: "{{risk.locations[0].yearBuilt}}" },
        { label: "Square feet", value: "{{enrichment.call.rce.squareFeet}}" },
        { label: "Quality", value: "{{enrichment.call.rce.quality}}" },
        { label: "Cost per square foot", value: "{{enrichment.call.rce.costPerSquareFoot}}" },
        { label: "Valuation", value: "{{enrichment.call.rce.valuationId}}" },
      ],
    },
    {
      id: "breakdown",
      type: "dataTable",
      title: "Cost breakdown",
      path: "enrichment.call.rce.breakdown",
      columns: [
        { label: "Component", path: "component" },
        { label: "Amount", path: "amount" },
      ],
      total: { label: "Estimated replacement cost", path: "enrichment.call.rce.replacementCost" },
    },
    {
      id: "exclusions",
      type: "dataTable",
      title: "Exclusions",
      path: "enrichment.call.rce.breakdown",
      rowWhen: "$.excluded == true",
      columns: [
        { label: "Component", path: "component" },
        { label: "Amount", path: "amount" },
      ],
      total: {
        label: "Insurable replacement cost",
        path: "enrichment.call.rce.insurableReplacementCost",
      },
    },
    {
      id: "disclaimer",
      type: "text",
      body: "This estimate is for insurance purposes only and isn't an appraisal.",
    },
  ],
};

async function installMockData() {
  await container.integrations.configure(ctx, {
    providerId: "mock_data",
    environment: "live",
    config: {
      scenario: "normal",
      reports: false,
      costPerCall: 0.25,
      fixtures: [
        {
          match: FIXTURE_STREET,
          capability: "replacement_cost",
          response: { replacementCost: 512_000, insurableReplacementCost: 478_000 },
        },
      ],
    },
    secrets: {},
  });

  await container.integrations.setStatus(ctx, { providerId: "mock_data", enabled: true });
}

async function seedVersion() {
  const product = await prisma.product.findFirstOrThrow({
    where: { tenantId: tenant.id, key: PRODUCT_KEY },
  });

  const versions = await prisma.productVersion.findMany({ where: { productId: product.id } });
  const existing = versions.find((v) => v.version === VERSION);

  if (existing?.status === "PUBLISHED") return { productId: product.id, note: "already published" };

  const base = versions.find((v) => v.version === BASE_VERSION && v.status === "PUBLISHED");

  if (!base) throw new Error(`${BASE_VERSION} isn't published`);

  const draft =
    existing ??
    (await uc.catalog.createVersion(ctx, {
      productId: product.id,
      version: VERSION,
      copyFromId: base.id,
    }));

  const current = await uc.catalog.getVersion(ctx, { id: draft.id });

  const locations = current.riskSchema.fields.map((node) =>
    node.key === "locations" && node.kind === "repeatable"
      ? {
          ...node,
          children: [
            ...node.children.filter((c) => !["squareFeet", "replacementCost"].includes(c.key)),
            { key: "squareFeet", label: "Square feet", kind: "integer" as const },
            {
              key: "replacementCost",
              label: "Replacement cost",
              kind: "money" as const,
              currency: "USD",
            },
          ],
        }
      : node,
  );

  await uc.catalog.updateVersion(ctx, {
    id: draft.id,
    riskSchema: { fields: locations },
    enrichment: ENRICHMENT as never,
    documents: {
      ...current.documents,
      templates: [
        ...current.documents.templates.filter((t) => t.key !== REPORT_TEMPLATE.key),
        REPORT_TEMPLATE as never,
      ],
    },
    availability: current.availability.map((window) => ({
      ...window,
      newBusiness: { from: NEW_BUSINESS_FROM },
      renewal: { from: RENEWAL_FROM },
    })),
  });

  const issues = await uc.catalog.checkVersion(ctx, { id: draft.id });
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length) throw new Error(`Checks failed: ${JSON.stringify(errors, null, 2)}`);

  if (current.status === "draft") await uc.catalog.submitVersion(ctx, { id: draft.id });

  await uc.catalog.publishVersion(ctx, { id: draft.id });

  return { productId: product.id, note: `published; warnings: ${JSON.stringify(issues)}` };
}

async function quote(productId: string, squareFeet: number) {
  const scope = { kind: "tenant" } as const;

  const started = await uc.submissions.start(ctx, {
    productId,
    jurisdiction: { country: "US", subdivision: "US-IL" },
    effectiveDate: "2028-09-15",
    producerName: owner.user.name,
  });

  const place = {
    line1: FIXTURE_STREET,
    city: "Evanston",
    region: "IL",
    postalCode: "60201",
    country: "US",
  };

  const result = await uc.submissions.submit(ctx, scope, {
    id: started.id,
    riskData: {
      insured: { firstName: "Jordan", lastName: "Reyes", email: "jordan.reyes@example.com" },
      mailingAddress: place,
      priorClaims: 0,
      locations: [
        {
          address: place,
          yearBuilt: 1998,
          construction: "frame",
          roofAge: 6,
          hasSumpPump: true,
          coastalCounty: false,
          squareFeet,
        },
      ],
    },
  });

  return { submissionId: started.id, result };
}

await installMockData();
const { productId, note } = await seedVersion();
console.log(`${VERSION}: ${note}`);

const first = await quote(productId, 2400);
console.log(JSON.stringify(first.result, null, 2).slice(0, 600));

const view = await uc.quotes.enrichment.view(
  ctx,
  { kind: "tenant" },
  {
    submissionId: first.submissionId,
  },
);

console.log(JSON.stringify(view, null, 2));

if (view?.reports[0]) {
  const report = await uc.quotes.enrichment.report(
    ctx,
    { kind: "tenant" },
    {
      submissionId: first.submissionId,
      recordId: view.reports[0].recordId,
      reportId: view.reports[0].reportId,
    },
  );

  const { writeFile } = await import("node:fs/promises");
  await writeFile("/tmp/rce-report.pdf", report.body);
  console.log(`report: /tmp/rce-report.pdf (${report.body.byteLength} bytes)`);
}

const records = await prisma.enrichmentRecord.count({
  where: { submissionId: first.submissionId },
});

await uc.quotes.customize(
  ctx,
  { kind: "tenant" },
  { submissionId: first.submissionId, selection: [] },
);

const after = await prisma.enrichmentRecord.count({ where: { submissionId: first.submissionId } });
console.log(`records before customize: ${records}, after: ${after} (reused when equal)`);

await container.clocks.stop?.();
process.exit(0);
