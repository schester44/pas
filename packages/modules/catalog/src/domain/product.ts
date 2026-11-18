import {
  AggregateRoot,
  type Clock,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";

export type ProductId = Id<"Product">;
export type ProductStatus = "draft" | "active" | "retired";

export interface ProductProps {
  id: ProductId;
  tenantId: TenantId;
  key: string;
  name: string;
  lineOfBusiness: string;
  status: ProductStatus;
  createdAt: Instant;
  updatedAt: Instant;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * A tenant's long-lived product identity (e.g. "Homeowners — Coastal Program").
 * Versions, releases and configuration artifacts hang off it (see PLAN §6).
 */
export class Product extends AggregateRoot {
  private constructor(private props: ProductProps) {
    super();
  }

  static create(
    input: { tenantId: TenantId; key: string; name: string; lineOfBusiness: string },
    clock: Clock,
  ): Product {
    const key = input.key.trim().toLowerCase();
    if (!KEY_PATTERN.test(key)) {
      throw invalid("Product key must be 2-63 lowercase letters, digits or dashes", { key });
    }
    const name = input.name.trim();
    if (!name) throw invalid("Product name is required");

    const now = clock.now();
    const product = new Product({
      id: newId<"Product">(),
      tenantId: input.tenantId,
      key,
      name,
      lineOfBusiness: input.lineOfBusiness.trim(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    product.record({
      id: newId(),
      type: "catalog.product_created",
      tenantId: input.tenantId,
      aggregateType: "product",
      aggregateId: product.id,
      occurredAt: now,
      payload: { key, name },
    });
    return product;
  }

  /** Rebuild from persistence. No invariants re-checked, no events. */
  static restore(props: ProductProps): Product {
    return new Product(props);
  }

  get id(): ProductId {
    return this.props.id;
  }

  toSnapshot(): Readonly<ProductProps> {
    return { ...this.props };
  }
}
