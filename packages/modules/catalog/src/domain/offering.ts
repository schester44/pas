import {
  AggregateRoot,
  type Clock,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";

export type OfferingId = Id<"Offering">;
export type OfferingStatus = "active" | "retired";

export const SELECTION_STRATEGIES = ["all_eligible", "cheapest", "first_eligible"] as const;
export type SelectionStrategy = (typeof SELECTION_STRATEGIES)[number];

export interface OfferingProps {
  id: OfferingId;
  tenantId: TenantId;
  key: string;
  name: string;
  /** Ordered: the order is the tenant's preference and picks the intake (PLAN §6.0). */
  productIds: string[];
  selection: SelectionStrategy;
  status: OfferingStatus;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface OfferingInput {
  name: string;
  productIds: readonly string[];
  selection: SelectionStrategy;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** What agents and customers pick ("Landlord"); PAS quotes its member products (PLAN §6.0). */
export class Offering extends AggregateRoot {
  private constructor(private props: OfferingProps) {
    super();
  }

  static create(input: OfferingInput & { tenantId: TenantId; key: string }, clock: Clock) {
    const key = input.key.trim().toLowerCase();

    if (!KEY_PATTERN.test(key)) {
      throw invalid("Offering key must be 2-63 lowercase letters, digits or dashes", { key });
    }

    const now = clock.now();

    const offering = new Offering({
      id: newId<"Offering">(),
      tenantId: input.tenantId,
      key,
      ...validated(input),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    offering.recordEvent("catalog.offering_created", now);

    return offering;
  }

  static restore(props: OfferingProps): Offering {
    return new Offering(props);
  }

  get id(): OfferingId {
    return this.props.id;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }

  update(input: OfferingInput, clock: Clock): void {
    const now = clock.now();
    this.props = { ...this.props, ...validated(input), updatedAt: now };
    this.recordEvent("catalog.offering_updated", now);
  }

  retire(clock: Clock): void {
    if (this.props.status === "retired") return;

    const now = clock.now();
    this.props = { ...this.props, status: "retired", updatedAt: now };
    this.recordEvent("catalog.offering_retired", now);
  }

  activate(clock: Clock): void {
    if (this.props.status === "active") return;

    const now = clock.now();
    this.props = { ...this.props, status: "active", updatedAt: now };
    this.recordEvent("catalog.offering_updated", now);
  }

  toSnapshot(): Readonly<OfferingProps> {
    return { ...this.props, productIds: [...this.props.productIds] };
  }

  private recordEvent(type: string, occurredAt: Instant): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "offering",
      aggregateId: this.props.id,
      occurredAt,
      payload: {
        key: this.props.key,
        name: this.props.name,
        productIds: [...this.props.productIds],
        selection: this.props.selection,
      },
    });
  }
}

function validated(input: OfferingInput) {
  const name = input.name.trim();

  if (!name) throw invalid("Offering name is required");

  if (input.productIds.length === 0) throw invalid("An offering needs at least one product");

  if (new Set(input.productIds).size !== input.productIds.length) {
    throw invalid("A product can be in an offering only once");
  }

  if (!SELECTION_STRATEGIES.includes(input.selection)) {
    throw invalid("Unknown selection strategy", { selection: input.selection });
  }

  return { name, productIds: [...input.productIds], selection: input.selection };
}
