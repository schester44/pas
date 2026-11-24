// Seeds "Lakeside Mutual (mock)": carrier, test and live connections to the dev mock carrier, a
// configured connector recorded against the mock and published, and Homeowners Coastal 2028.1
// written through it. Idempotent; never touches published versions or drafts it didn't create.
import { MOCK_CARRIER_API_KEY, MOCK_CARRIER_CALLBACK_SECRET } from "@pas/carriers/infrastructure";
import { asId, type TenantContext } from "@pas/kernel";
import { compose } from "../composition";
import {
  MOCK_CARRIER_CONNECTOR,
  MOCK_CARRIER_URL as MOCK_URL,
  recordMockFixtures,
} from "./seed/mock-connector";

const TENANT_SLUG = "acme-mga";
const PRODUCT_NAME = "Homeowners Coastal";
const VERSION = "2028.1";
const NEW_BUSINESS_FROM = "2028-06-01";
const RENEWAL_FROM = "2028-08-01";
const CARRIER_KEY = "lakeside-mutual";

const OWNERSHIP = {
  transactions: {
    new_business: "carrier",
    endorsement: "carrier",
    cancellation: "carrier",
    reinstatement: "pas",
  },
  rating: "carrier",
  lineItems: "carrier",
  documents: { source: "both", order: "tenant_first" },
  policyNumber: "both",
  billing: "agency_bill",
};

const container = compose();
await container.clocks.start();
const { prisma } = container;
const carriers = container.carriers;
const uc = container.useCases;

const tenant = await prisma.organization.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

const owner = await prisma.member.findFirstOrThrow({
  where: { organizationId: tenant.id, role: "owner" },
});

const ctx: TenantContext = {
  tenantId: asId(tenant.id),
  actor: { type: "user", userId: asId(owner.userId) },
};

async function seedCarrier() {
  const listed = await carriers.manage.list(ctx);
  const existing = listed.find((c) => c.key === CARRIER_KEY);

  const carrier =
    existing ??
    (await carriers.manage.save(ctx, {
      key: CARRIER_KEY,
      name: "Lakeside Mutual (mock)",
      naic: "29714",
      amBest: "A (Excellent)",
      admitted: ["US-IL", "US-IN"],
      lines: ["Homeowners"],
      mode: "connector",
      activeEnvironment: "test",
    }));

  for (const environment of ["test", "live"] as const) {
    await carriers.manage.saveConnection(ctx, {
      carrierId: carrier.id,
      environment,
      baseUrl: MOCK_URL,
      auth: { kind: "api_key", header: "x-api-key" },
      callback: { signature: "hmac_sha256", header: "x-carrier-signature" },
      secrets: { apiKey: MOCK_CARRIER_API_KEY, callbackSecret: MOCK_CARRIER_CALLBACK_SECRET },
    });
  }

  return carrier;
}

async function seedConnector(carrierId: string) {
  const detail = await carriers.manage.get(ctx, { id: carrierId });

  if (detail.versions.some((v) => v.status === "published")) return "connector already published";

  const draft = await carriers.connector.createDraft(ctx, { carrierId });

  await carriers.connector.update(ctx, {
    id: draft.id,
    definition: MOCK_CARRIER_CONNECTOR,
    note: "Initial connector",
  });

  if ((await carriers.connector.fixtures(ctx, { carrierId })).length === 0) {
    await recordMockFixtures(prisma, tenant.id, [carrierId]);
  }

  const published = await carriers.connector.publish(ctx, {
    id: draft.id,
    note: "Recorded against the mock carrier",
  });

  return `connector v${published.version} published`;
}

async function seedVersion() {
  const product = await prisma.product.findFirstOrThrow({
    where: { tenantId: tenant.id, name: PRODUCT_NAME },
  });

  const versions = await prisma.productVersion.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: "asc" },
  });

  const existing = versions.find((v) => v.version === VERSION);

  if (existing?.status === "PUBLISHED") return `${VERSION} already published`;

  if (
    existing &&
    (existing.lifecycle as { carrier?: { carrier?: string } }).carrier?.carrier !== CARRIER_KEY
  ) {
    return `${VERSION} exists and isn't ours; left alone`;
  }

  const base = versions.filter((v) => v.status === "PUBLISHED").at(-1);

  if (!base) throw new Error(`${PRODUCT_NAME} has no published version to copy`);

  const draft =
    existing ??
    (await uc.catalog.createVersion(ctx, {
      productId: product.id,
      version: VERSION,
      copyFromId: base.id,
    }));

  const current = await uc.catalog.getVersion(ctx, { id: draft.id });

  await uc.catalog.updateVersion(ctx, {
    id: draft.id,
    lifecycle: { ...current.lifecycle, carrier: { carrier: CARRIER_KEY, ownership: OWNERSHIP } },
    availability: current.availability.map((window) => ({
      ...window,
      market: "admitted",
      newBusiness: { from: NEW_BUSINESS_FROM },
      renewal: { from: RENEWAL_FROM },
    })),
  });

  const issues = await uc.catalog.checkVersion(ctx, { id: draft.id });
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0)
    return `${VERSION} has ${errors.length} errors: ${JSON.stringify(errors).slice(0, 400)}`;

  if (current.status === "draft") await uc.catalog.submitVersion(ctx, { id: draft.id });

  await uc.catalog.publishVersion(ctx, { id: draft.id });

  return `${VERSION} published from ${base.version}`;
}

const carrier = await seedCarrier();
console.info(`carrier ${carrier.name}`);
console.info(await seedConnector(carrier.id));
console.info(await seedVersion());

await container.queues.stop();
await container.workflows.close();
container.clocks.stop();
process.exit(0);
