// Seeds Acme MGA: users, carriers, homeowners and landlord programs, integrations, distribution
// and underwriting settings, plus a sandbox copied from it. `pnpm db:fresh` resets the database
// and runs it; re-running it only adds what's missing.
import { MOCK_CARRIER_API_KEY, MOCK_CARRIER_CALLBACK_SECRET } from "@pas/carriers/infrastructure";
import { seedDistributionFor } from "@pas/db/seed";
import { asId, newId, type TenantContext } from "@pas/kernel";
import { createPlanRater, type RatingPlan } from "@pas/rating-engine";
import type { UnderwritingSettings } from "@pas/underwriting";
import { compose } from "../composition";
import { landlordContents, landlordRisk } from "./seed/landlord";
import { homeownersContents, sampleRisk } from "./seed/homeowners";
import {
  MOCK_CARRIER_CONNECTOR,
  MOCK_CARRIER_URL,
  recordMockFixtures,
} from "./seed/mock-connector";
import { CARRIERS, HOMEOWNERS_PROGRAMS, LANDLORD_PROGRAMS, type Program } from "./seed/programs";

const PASSWORD = "password1234";

const USERS = [
  { email: "dev@example.com", name: "Dev User", role: "owner" },
  { email: "riley.uw@example.com", name: "Riley Underwriter", role: "underwriter" },
  { email: "morgan.lee@example.com", name: "Morgan Lee", role: "agent" },
  { email: "jordan.reyes@example.com", name: "Jordan Reyes", role: "agency_admin" },
] as const;

const TENANT = { name: "Acme MGA", slug: "acme-mga" };
const VERSION = "2026.1";
const NEW_BUSINESS_FROM = "2026-01-01";
const RENEWAL_FROM = "2026-03-01";

const SETTINGS: UnderwritingSettings = {
  authorityProfiles: [
    {
      key: "underwriter",
      name: "Underwriter",
      level: 1,
      maxPremium: "5000",
      maxInsuredValue: "750000",
      products: [],
      jurisdictions: [],
      roles: ["underwriter"],
      userIds: [],
    },
    {
      key: "senior_underwriter",
      name: "Senior underwriter",
      level: 2,
      maxPremium: "15000",
      maxInsuredValue: "2000000",
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
      code: "LOSS_HISTORY",
      label: "Loss history",
      adverseActionNotice:
        "[Adverse action notice: loss history. Name the consumer reporting agency when its report contributed.]",
    },
    {
      code: "DWELLING_CONDITION",
      label: "Dwelling condition or age",
      adverseActionNotice:
        "[Adverse action notice: dwelling condition. Tenant compliance to supply the jurisdiction's required wording.]",
    },
    {
      code: "OCCUPANCY",
      label: "Occupancy or use outside our guidelines",
      adverseActionNotice:
        "[Adverse action notice: occupancy. Tenant compliance to supply the jurisdiction's required wording.]",
    },
    {
      code: "REPLACEMENT_COST",
      label: "Replacement cost outside our guidelines",
      adverseActionNotice:
        "[Adverse action notice: insured value. Tenant compliance to supply the jurisdiction's required wording.]",
    },
  ],
  overdueConsequence: "Consider cancellation",
};

const container = compose();
await container.clocks.start();
const { prisma } = container;
const uc = container.useCases;
const log = (message: string) => console.info(`  ${message}`);

async function seedUsers() {
  const ids = new Map<string, string>();

  for (const user of USERS) {
    const found = await prisma.user.findUnique({ where: { email: user.email } });

    const created =
      found ??
      (
        await container.auth.api.signUpEmail({
          body: { email: user.email, password: PASSWORD, name: user.name },
        })
      ).user;

    ids.set(user.email, created.id);
  }

  return ids;
}

async function seedTenant(users: Map<string, string>): Promise<TenantContext> {
  const now = new Date();

  const org =
    (await prisma.organization.findUnique({ where: { slug: TENANT.slug } })) ??
    (await prisma.organization.create({
      data: {
        id: newId(),
        name: TENANT.name,
        slug: TENANT.slug,
        createdAt: now,
        members: {
          create: USERS.map((user) => ({
            id: newId(),
            userId: users.get(user.email)!,
            role: user.role,
            createdAt: now,
          })),
        },
      },
    }));

  const ctx: TenantContext = {
    tenantId: asId(org.id),
    actor: { type: "user", userId: asId(users.get("dev@example.com")!) },
  };

  await uc.tenants.updateProfile(ctx, {
    displayName: TENANT.name,
    primaryColor: "#656ae5",
    logoUrl: null,
    appSubdomain: TENANT.slug,
    customDomains: [],
    supportEmail: "service@acme-mga.example",
    supportPhone: "(312) 555-0100",
  });

  return ctx;
}

async function seedCarriers(ctx: TenantContext) {
  const { manage, connector, feeds } = container.carriers;
  const existing = new Set((await manage.list(ctx)).map((carrier) => carrier.key));
  const api: string[] = [];

  for (const seed of CARRIERS) {
    if (existing.has(seed.key)) continue;

    const carrier = await manage.save(ctx, {
      key: seed.key,
      name: seed.name,
      naic: seed.naic,
      admitted: seed.admitted,
      lines: seed.lines,
      mode: seed.mode,
      activeEnvironment: "test",
    });

    if (seed.mode === "file_feed") {
      await feeds.save(ctx, {
        carrierId: carrier.id,
        name: "Monthly bordereau",
        format: "bordereaux_csv",
        channel: "email",
        destination: { email: `bordereaux@${seed.key}.example` },
        schedule: "monthly",
        status: "active",
      });

      log(`${seed.name}: paper carrier with a monthly bordereau`);
      continue;
    }

    for (const environment of ["test", "live"] as const) {
      await manage.saveConnection(ctx, {
        carrierId: carrier.id,
        environment,
        baseUrl: MOCK_CARRIER_URL,
        auth: { kind: "api_key", header: "x-api-key" },
        callback: { signature: "hmac_sha256", header: "x-carrier-signature" },
        secrets: { apiKey: MOCK_CARRIER_API_KEY, callbackSecret: MOCK_CARRIER_CALLBACK_SECRET },
      });
    }

    api.push(carrier.id);
  }

  if (api.length === 0) return;

  await recordMockFixtures(prisma, ctx.tenantId, api);

  for (const carrierId of api) {
    const draft = await connector.createDraft(ctx, { carrierId });

    await connector.update(ctx, {
      id: draft.id,
      definition: MOCK_CARRIER_CONNECTOR,
      note: "Connector for the carrier's quote, bind and policy API",
    });

    await connector.publish(ctx, { id: draft.id, note: "Recorded against the mock carrier" });
  }

  log(`${api.length} API carriers connected to the mock carrier`);
}

type OptionSet = {
  options: { kind: string; amount?: string; value?: string }[];
  defaultIndex: number;
};

function defaultAmount(set: OptionSet) {
  const option = set.options[set.defaultIndex]!;

  return option.kind === "money" ? option.amount! : option.value!;
}

/** Golden cases priced by the plan itself, so later rate changes show up as diffs. */
async function goldenCases(
  plan: RatingPlan,
  coverages: ReturnType<typeof homeownersContents>["coverages"],
  risks: { name: string; risk: Record<string, unknown> }[],
) {
  const rater = createPlanRater(plan);

  const selections = coverages.map((coverage) => ({
    coverage: coverage.code,
    ...(coverage.attachesTo.level === "exposure" && { exposure: "locations[0]" }),
    ...(coverage.limitOptions && { limit: defaultAmount(coverage.limitOptions) }),
    ...("deductibleOptions" in coverage &&
      coverage.deductibleOptions && { deductible: defaultAmount(coverage.deductibleOptions) }),
  }));

  return Promise.all(
    risks.map(async ({ name, risk: full }, i) => {
      const {
        jurisdiction,
        market: _market,
        ...risk
      } = full as {
        jurisdiction: { country: string; subdivision: string };
        market: string;
      };

      const input = {
        risk,
        coverages: selections,
        term: { effective: "2026-12-01", expiration: "2027-12-01" },
        transaction: { type: "NEW_BUSINESS" as const, effective: "2026-12-01" },
        jurisdiction,
        currency: "USD" as const,
      };

      const result = await rater.rate(input);

      return {
        id: `golden-${i + 1}`,
        name,
        input,
        expected: {
          total: result.total.amount.toString(),
          coverages: result.coverages.map((c) => ({
            coverage: c.coverage,
            ...(c.exposure && { exposure: c.exposure }),
            premium: c.premium.amount.toString(),
          })),
        },
        tolerance: { absolute: "0.01" },
      };
    }),
  );
}

async function publishProgram(
  ctx: TenantContext,
  program: Program<unknown>,
  contents: ReturnType<typeof homeownersContents> | ReturnType<typeof landlordContents>,
  risks: { name: string; risk: Record<string, unknown> }[],
) {
  const found = await prisma.product.findFirst({
    where: { tenantId: ctx.tenantId, key: program.product.key },
    include: { versions: true },
  });

  if (found?.versions.some((v) => v.status === "PUBLISHED")) return;

  const product = found ?? (await uc.catalog.createProduct(ctx, program.product));
  const pending = found?.versions.find((v) => v.version === VERSION);

  const draft =
    pending ?? (await uc.catalog.createVersion(ctx, { productId: product.id, version: VERSION }));

  if (pending?.status === "IN_REVIEW") await uc.catalog.reopenVersion(ctx, { id: draft.id });

  const plan = contents.rating.plan as unknown as RatingPlan;

  await uc.catalog.updateVersion(ctx, {
    ...(contents as unknown as Parameters<typeof uc.catalog.updateVersion>[1]),
    id: draft.id,
    rating: {
      engine: "plan",
      plan,
      goldenCases: await goldenCases(plan, contents.coverages as never, risks),
    },
    lifecycle: {
      ...contents.lifecycle,
      carrier: { carrier: program.carrier, ownership: program.ownership },
    },
    availability: program.jurisdictions.map((subdivision) => ({
      jurisdiction: { country: "US", subdivision },
      market: program.market,
      newBusiness: { from: NEW_BUSINESS_FROM },
      renewal: { from: RENEWAL_FROM },
    })),
  });

  const issues = await uc.catalog.checkVersion(ctx, { id: draft.id });
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    for (const error of errors)
      console.error(`    ✗ ${error.message} ${JSON.stringify(error.target)}`);

    throw new Error(`${program.product.name} ${VERSION} has ${errors.length} errors`);
  }

  await uc.catalog.submitVersion(ctx, { id: draft.id });
  await uc.catalog.publishVersion(ctx, { id: draft.id });

  const warnings = issues.length - errors.length;

  log(`${program.product.name} ${VERSION} published${warnings ? ` (${warnings} warnings)` : ""}`);
}

async function seedProducts(ctx: TenantContext) {
  for (const program of HOMEOWNERS_PROGRAMS) {
    await publishProgram(ctx, program, homeownersContents(program.config), [
      { name: "Illinois frame home", risk: sampleRisk() },
      {
        name: "Indiana masonry home with an older roof",
        risk: {
          ...sampleRisk({
            construction: "masonry",
            roofAge: 18,
            protectionClass: 5,
            yearBuilt: 1972,
          }),
          jurisdiction: { country: "US", subdivision: "US-IN" },
        },
      },
    ]);
  }

  for (const program of LANDLORD_PROGRAMS) {
    await publishProgram(ctx, program, landlordContents(program.config), [
      { name: "Chicago masonry duplex", risk: landlordRisk() },
      {
        name: "Indiana frame fourplex",
        risk: {
          ...landlordRisk({
            dwellingType: "quadplex",
            units: 4,
            construction: "frame",
            roofAge: 14,
          }),
          jurisdiction: { country: "US", subdivision: "US-IN" },
        },
      },
    ]);
  }
}

/** What agents pick: one offering per line, its carrier programs in preference order (PLAN §6.0). */
async function seedOfferings(ctx: TenantContext) {
  const existing = new Set(
    (await prisma.offering.findMany({ where: { tenantId: ctx.tenantId } })).map((o) => o.key),
  );

  const products = await prisma.product.findMany({ where: { tenantId: ctx.tenantId } });
  const idOf = (key: string) => products.find((p) => p.key === key)!.id;

  const offerings = [
    { key: "landlord", name: "Landlord", programs: LANDLORD_PROGRAMS },
    { key: "homeowners", name: "Homeowners", programs: HOMEOWNERS_PROGRAMS },
  ];

  for (const offering of offerings) {
    if (existing.has(offering.key)) continue;

    await uc.catalog.createOffering(ctx, {
      key: offering.key,
      name: offering.name,
      selection: "all_eligible",
      productIds: offering.programs.map((program) => idOf(program.product.key)),
    });

    log(`Offering ${offering.name} created`);
  }
}

async function seedIntegrations(ctx: TenantContext, environment: "test" | "live") {
  const { configure, setStatus } = container.integrations;

  const enabled = [
    { providerId: "mock_data", config: {} },
    { providerId: "file_export", config: { format: "csv", jurisdictions: "US-IN" } },
  ];

  const awaitingCredentials = [
    { providerId: "smarty", config: {} },
    { providerId: "hazardhub", config: {} },
    { providerId: "e2value", config: {} },
    { providerId: "slai", config: {} },
    { providerId: "lob", config: {} },
    { providerId: "nipr_pdb", config: {} },
    {
      providerId: "postmark",
      config: { fromAddress: "policies@acme-mga.example", fromName: TENANT.name },
    },
  ];

  const available = (install: { providerId: string }) =>
    environment === "live" ||
    container.integrations.catalog.get(install.providerId)?.manifest.testMode;

  const pending = awaitingCredentials.filter(available);

  for (const install of [...enabled, ...pending]) {
    await configure(ctx, { ...install, environment, secrets: {} });
  }

  for (const install of enabled)
    await setStatus(ctx, { providerId: install.providerId, enabled: true });

  log(`${enabled.length} integrations on, ${pending.length} waiting for credentials`);
}

async function main() {
  console.info("Users");
  const users = await seedUsers();
  log(`${users.size} users, password ${PASSWORD}`);

  console.info(TENANT.name);
  const ctx = await seedTenant(users);

  await seedCarriers(ctx);
  await seedProducts(ctx);
  await seedOfferings(ctx);
  await seedIntegrations(ctx, "live");
  await uc.underwriting.settings.update(ctx, SETTINGS);
  log("Underwriting authority and decline reasons");

  await seedDistributionFor(prisma, ctx.tenantId, {
    carriers: CARRIERS.map((c) => ({ name: c.name, subdivisions: c.writes })),
  });

  log("Agencies, producers, licenses and appointments");

  console.info(`${TENANT.name} Sandbox`);
  await seedIntegrations({ ...ctx, tenantId: asId(await seedSandbox(ctx)) }, "test");
}

async function seedSandbox(ctx: TenantContext): Promise<string> {
  const existing = await prisma.tenantEnvironment.findFirst({
    where: { parentTenantId: ctx.tenantId },
  });

  if (existing) return existing.tenantId;

  const sandbox = await uc.tenants.createSandbox(ctx, { name: `${TENANT.name} Sandbox` });
  const copied = Object.entries(sandbox.copied).map(([what, n]) => `${n} ${what}`);

  log(`Copied ${copied.join(", ")}`);

  return sandbox.tenantId;
}

try {
  await main();
} finally {
  await container.queues.stop();
  await container.workflows.close();
  container.clocks.stop();
  await prisma.$disconnect();
}

process.exit(0);
