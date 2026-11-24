import { newId } from "@pas/kernel";
import type { PrismaClient } from "../../client";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const AGENCIES = {
  "Lakeshore Insurance Group": {
    legalName: "Lakeshore Insurance Group, LLC",
    fein: "36-4182937",
    address: {
      line1: "233 S Wacker Dr",
      line2: "Suite 4100",
      city: "Chicago",
      region: "IL",
      postalCode: "60606",
      country: "US",
    },
    phone: "(312) 555-0142",
    email: "service@lakeshoreig.example",
    tier: "preferred",
    agencyBillEligible: true,
    remittanceDays: 30,
    creditLimit: "50000",
    remittanceBasis: "net",
    statementDay: 25,
    reminderDays: 10,
    suspendAfterDays: 30,
  },
  "North Shore Brokers": {
    legalName: "North Shore Brokers, Inc.",
    fein: "36-5520194",
    address: {
      line1: "1603 Orrington Ave",
      city: "Evanston",
      region: "IL",
      postalCode: "60201",
      country: "US",
    },
    phone: "(847) 555-0178",
    email: "hello@northshorebrokers.example",
    tier: "standard",
    agencyBillEligible: false,
    remittanceDays: null,
    creditLimit: null,
  },
} as const;

const PRODUCERS = [
  {
    email: "dev@example.com",
    agency: "Lakeshore Insurance Group",
    npn: "17283946",
    producerNumber: "LIG-001",
    licenses: [
      {
        subdivision: "US-IL",
        number: "IL-3001829",
        lines: ["Property", "Casualty", "Personal Lines"],
        expires: "2028-03-31",
      },
      {
        subdivision: "US-IN",
        number: "IN-0928173",
        lines: ["Property", "Casualty"],
        expires: "2026-12-15",
      },
    ],
  },
  {
    email: "morgan.lee@example.com",
    agency: "North Shore Brokers",
    npn: "19384752",
    producerNumber: "NSB-014",
    licenses: [
      {
        subdivision: "US-IL",
        number: "IL-3118402",
        lines: ["Property", "Casualty"],
        expires: "2027-09-30",
      },
    ],
  },
];

/** Re-seeds every tenant that already has the demo agencies. Safe to re-run. */
export async function seedDistribution(db: PrismaClient) {
  const tenants = await db.agency.findMany({
    where: { name: { in: Object.keys(AGENCIES) } },
    distinct: ["tenantId"],
  });

  for (const { tenantId } of tenants) {
    await seedDistributionFor(db, tenantId, {
      carriers: [{ name: "Great Lakes Mutual", subdivisions: ["US-IL", "US-IN"] }],
    });
  }
}

/**
 * The demo distribution network for one tenant: Lakeshore Insurance Group with North Shore Brokers
 * as a sub-agency, appointments with each carrier where it writes, producer licenses (Lakeshore's
 * producers are licensed everywhere Lakeshore is appointed), a commission schedule and a blocking
 * licensing requirement on every product. Safe to re-run.
 */
export async function seedDistributionFor(
  db: PrismaClient,
  tenantId: string,
  options: { carriers: readonly { name: string; subdivisions: readonly string[] }[] },
) {
  const now = new Date();
  const appointed = [...new Set(options.carriers.flatMap((carrier) => carrier.subdivisions))];

  const ids: Record<string, string> = {};

  for (const [name, details] of Object.entries(AGENCIES)) {
    const existing = await db.agency.findFirst({ where: { tenantId, name } });
    const id = existing?.id ?? newId();
    const data = { ...details, address: details.address, status: "active", updatedAt: now };

    await db.agency.upsert({
      where: { id },
      update: data,
      create: { ...data, id, tenantId, name, createdAt: now },
    });

    ids[name] = id;
  }

  await db.agency.update({
    where: { id: ids["North Shore Brokers"]! },
    data: { parentId: ids["Lakeshore Insurance Group"]! },
  });

  for (const seed of PRODUCERS) {
    const user = await db.user.findUnique({ where: { email: seed.email } });

    if (!user) continue;

    const producer =
      (await db.producer.findFirst({ where: { tenantId, userId: user.id } })) ??
      (await db.producer.create({
        data: {
          id: newId(),
          tenantId,
          userId: user.id,
          name: user.name,
          email: seed.email,
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      }));

    await db.producer.update({
      where: { id: producer.id },
      data: { npn: seed.npn, producerNumber: seed.producerNumber, status: "active" },
    });

    const agencyId = ids[seed.agency]!;

    await db.agencyMembership.upsert({
      where: { tenantId_agencyId_producerId: { tenantId, agencyId, producerId: producer.id } },
      update: { primary: true },
      create: {
        id: newId(),
        tenantId,
        agencyId,
        producerId: producer.id,
        role: "producer",
        primary: true,
        createdAt: now,
      },
    });

    await db.producerLicense.deleteMany({ where: { tenantId, producerId: producer.id } });

    const listed = new Set(seed.licenses.map((l) => l.subdivision));

    const appointedOnly =
      seed.agency === "Lakeshore Insurance Group"
        ? appointed
            .filter((subdivision) => !listed.has(subdivision))
            .map((subdivision) => ({
              subdivision,
              number: `${subdivision.slice(3)}-${seed.npn}`,
              lines: ["Property", "Casualty", "Personal Lines"],
              expires: "2028-03-31",
            }))
        : [];

    await db.producerLicense.createMany({
      data: [...seed.licenses, ...appointedOnly].map((l) => ({
        id: newId(),
        tenantId,
        producerId: producer.id,
        npn: seed.npn,
        country: "US",
        subdivision: l.subdivision,
        licenseNumber: l.number,
        linesOfAuthority: l.lines,
        effectiveDate: day("2024-01-01"),
        expirationDate: day(l.expires),
        status: "active",
        source: "manual",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      })),
    });
  }

  await db.appointment.deleteMany({ where: { tenantId } });

  await db.appointment.createMany({
    data: options.carriers.flatMap((carrier) =>
      carrier.subdivisions.map((subdivision) => ({
        id: newId(),
        tenantId,
        agencyId: ids["Lakeshore Insurance Group"]!,
        carrier: carrier.name,
        country: "US",
        subdivision,
        status: "active",
        effectiveDate: day("2024-01-01"),
        createdAt: now,
      })),
    ),
  });

  await db.commissionSchedule.deleteMany({ where: { tenantId } });

  await db.commissionSchedule.createMany({
    data: [
      { business: "new", tier: null, rate: "12" },
      { business: "renewal", tier: null, rate: "10" },
      { business: "new", tier: "preferred", rate: "15" },
      { business: "renewal", tier: "preferred", rate: "12.5" },
    ].map((s) => ({
      id: newId(),
      tenantId,
      productId: null,
      country: "US",
      subdivision: null,
      ...s,
      effectiveDate: day("2024-01-01"),
      createdAt: now,
    })),
  });

  for (const product of await db.product.findMany({ where: { tenantId } })) {
    await db.licensingRequirement.upsert({
      where: { tenantId_productId: { tenantId, productId: product.id } },
      update: { mode: "block", linesOfAuthority: ["Property"], updatedAt: now },
      create: {
        id: newId(),
        tenantId,
        productId: product.id,
        mode: "block",
        linesOfAuthority: ["Property"],
        updatedAt: now,
      },
    });
  }
}
