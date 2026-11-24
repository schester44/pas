import { newId } from "@pas/kernel";
import { migration } from "../types";

const keyOf = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .padEnd(2, "0");

/**
 * Agents now pick an offering, not a product (PLAN §6.0). Tenants without offerings get one per
 * line of business over their active products, oldest first, where the agent compares quotes.
 */
export default migration({
  name: "20261124-01-offerings-by-line",
  async up({ db }) {
    const products = await db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });

    const tenants = Map.groupBy(products, (p) => p.tenantId);
    const now = new Date();

    for (const [tenantId, owned] of tenants) {
      if ((await db.offering.count({ where: { tenantId } })) > 0) continue;

      for (const [line, members] of Map.groupBy(owned, (p) => p.lineOfBusiness.trim() || "Other")) {
        await db.offering.create({
          data: {
            id: newId(),
            tenantId,
            key: keyOf(line),
            name: line,
            productIds: members.map((p) => p.id),
            selection: "all_eligible",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
  },
});
