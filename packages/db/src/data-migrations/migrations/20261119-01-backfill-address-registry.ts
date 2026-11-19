import {
  type AddressInput,
  createFakeAddressProvider,
  registryKey,
  textKey,
  type Verification,
} from "@pas/addressing";
import { isRecord, newId } from "@pas/kernel";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { migration } from "../types";

type Json = Record<string, unknown>;

interface Found {
  addressId: string;
  role: "location" | "mailing";
}

const isAddress = (value: unknown): value is AddressInput & Json =>
  isRecord(value) &&
  typeof value.line1 === "string" &&
  typeof value.city === "string" &&
  typeof value.region === "string" &&
  Boolean(value.line1.trim() && value.city.trim());

const fake = createFakeAddressProvider();

/** One registry record per address per tenant, created from the built-in standardizer. */
function registry(db: PrismaClient, tenantId: string) {
  const cache = new Map<string, { id: string; verified: boolean; address: Json }>();

  return async (input: AddressInput): Promise<{ id: string; verified: boolean; address: Json }> => {
    const entered = {
      ...input,
      postalCode: input.postalCode ?? "",
      country: input.country || "US",
    };

    const v: Verification = await fake.verify!(entered, { signal: AbortSignal.timeout(1000) });
    const key = registryKey(v);
    const hit = cache.get(key);

    if (hit) return hit;

    const existing =
      (await db.addressRecord.findUnique({ where: { tenantId_key: { tenantId, key } } })) ??
      (await db.addressRecord.findFirst({
        where: { tenantId, textKey: { in: [textKey(v.address), textKey(entered)] } },
        orderBy: { createdAt: "asc" },
      }));

    const now = new Date();
    const id = existing?.id ?? newId();

    if (!existing) {
      await db.addressRecord.create({
        data: {
          id,
          tenantId,
          key,
          textKey: textKey(v.address),
          provider: v.provider,
          providerAddressId: v.providerAddressId,
          status: v.status,
          line1: v.address.line1,
          line2: v.address.line2 ?? null,
          city: v.address.city,
          region: v.address.region,
          postalCode: v.address.postalCode,
          plus4: v.address.plus4 ?? null,
          country: v.address.country,
          components: v.address.components as Prisma.InputJsonObject,
          countyName: v.address.county?.name ?? null,
          countyFips: v.address.county?.fips ?? null,
          latitude: v.geocode?.latitude ?? null,
          longitude: v.geocode?.longitude ?? null,
          geocodePrecision: v.geocode?.precision ?? null,
          geocodeSource: v.geocode?.source ?? null,
          dpvMatch: v.dpv.match,
          vacant: v.dpv.vacant,
          deliverable: v.dpv.deliverable,
          verifiedAt: v.status === "verified" ? now : null,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    const verified = existing ? existing.status === "verified" : v.status === "verified";
    const source = verified && !existing ? v.address : entered;

    const resolved = {
      id,
      verified,
      address: {
        line1: source.line1,
        ...(source.line2 && { line2: source.line2 }),
        city: source.city,
        region: source.region,
        postalCode: source.postalCode,
        country: source.country,
      },
    };

    cache.set(key, resolved);

    return resolved;
  };
}

/** Stamps every address in a document; addresses inside lists are risk locations. */
async function stamp(
  value: unknown,
  resolve: ReturnType<typeof registry>,
  found: Found[],
  inList = false,
): Promise<unknown> {
  if (isAddress(value)) {
    const known = typeof value.addressId === "string" ? value.addressId : null;
    const record = known ? null : await resolve(value);
    const addressId = known ?? record!.id;

    found.push({ addressId, role: inList ? "location" : "mailing" });

    return record ? { ...value, ...record.address, addressId, verified: record.verified } : value;
  }

  // Sequential, so the same address twice in one document makes one record.
  if (Array.isArray(value)) {
    const items: unknown[] = [];

    for (const item of value) items.push(await stamp(item, resolve, found, true));

    return items;
  }

  if (!isRecord(value)) return value;

  const entries: [string, unknown][] = [];

  for (const [k, v] of Object.entries(value))
    entries.push([k, await stamp(v, resolve, found, inList)]);

  return Object.fromEntries(entries);
}

async function track(
  db: PrismaClient,
  tenantId: string,
  subject: { kind: string; id: string; label: string },
  found: readonly Found[],
  extra: { productId?: string; producerId?: string; producerName?: string; active: boolean },
) {
  const now = new Date();

  await db.addressUsage.createMany({
    data: found.map((f) => ({
      id: newId(),
      tenantId,
      addressId: f.addressId,
      subjectKind: subject.kind,
      subjectId: subject.id,
      subjectLabel: subject.label,
      role: f.role,
      productId: extra.productId ?? null,
      producerId: extra.producerId ?? null,
      producerName: extra.producerName ?? null,
      active: extra.active,
      createdAt: now,
      updatedAt: now,
    })),
    skipDuplicates: true,
  });
}

/**
 * Addresses entered before the registry existed (PLAN §15.9) get records from the built-in
 * standardizer: demo-city addresses verify, the rest are kept as entered and marked unverified.
 * Issued term versions are immutable, so policies link to records through usages only.
 */
export default migration({
  name: "20261119-01-backfill-address-registry",
  async up({ db }) {
    const resolvers = new Map<string, ReturnType<typeof registry>>();

    const resolverFor = (tenantId: string) => {
      const existing = resolvers.get(tenantId);

      if (existing) return existing;

      const created = registry(db, tenantId);
      resolvers.set(tenantId, created);

      return created;
    };

    const quotes = await db.quote.findMany();
    const quoteBySubmission = new Map(quotes.map((q) => [q.submissionId, q]));

    for (const s of await db.submission.findMany()) {
      const found: Found[] = [];
      const riskData = await stamp(s.riskData, resolverFor(s.tenantId), found);
      const quote = quoteBySubmission.get(s.id);

      await db.submission.update({
        where: { id: s.id },
        data: { riskData: riskData as Prisma.InputJsonObject },
      });

      await track(db, s.tenantId, { kind: "submission", id: s.id, label: s.number }, found, {
        productId: s.productId,
        producerId: s.producerId,
        producerName: s.producerName,
        active: s.status === "SUBMITTED" && quote?.status !== "BOUND",
      });
    }

    for (const q of quotes) {
      const found: Found[] = [];
      const resolve = resolverFor(q.tenantId);
      const riskData = await stamp(q.riskData, resolve, found);
      const details = q.details ? await stamp(q.details, resolve, []) : null;

      await db.quote.update({
        where: { id: q.id },
        data: {
          riskData: riskData as Prisma.InputJsonObject,
          ...(details !== null && { details: details as Prisma.InputJsonObject }),
        },
      });

      const policy = q.policyId ? await db.policy.findUnique({ where: { id: q.policyId } }) : null;

      if (!policy) continue;

      const term = await db.policyTerm.findFirst({
        where: { policyId: policy.id },
        orderBy: { termNumber: "desc" },
      });

      const mailing: Found[] = [];
      await stamp(isRecord(details) ? details.mailingAddress : null, resolve, mailing);

      await track(
        db,
        q.tenantId,
        { kind: "policy", id: policy.id, label: policy.number },
        [...found.filter((f) => f.role === "location"), ...mailing],
        {
          productId: policy.productId,
          producerId: policy.producerId,
          producerName: policy.producerName,
          active: term ? !["EXPIRED", "CANCELLED"].includes(term.status) : true,
        },
      );
    }

    for (const account of await db.clientAccount.findMany()) {
      if (!isRecord(account.mailingAddress)) continue;

      const found: Found[] = [];

      const mailingAddress = await stamp(
        account.mailingAddress,
        resolverFor(account.tenantId),
        found,
      );

      await db.clientAccount.update({
        where: { id: account.id },
        data: { mailingAddress: mailingAddress as Prisma.InputJsonObject },
      });

      await track(
        db,
        account.tenantId,
        { kind: "client_account", id: account.id, label: account.displayName },
        found,
        { active: account.status === "active" },
      );
    }
  },
});
