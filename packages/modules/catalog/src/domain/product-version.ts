import {
  AggregateRoot,
  type Clock,
  DomainError,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import type { CheckIssue } from "./checks";
import type { ProductId } from "./product";
import type { ProductReleaseId } from "./product-release";
import { emptyContents, type VersionContents } from "./version-contents";

export type ProductVersionId = Id<"ProductVersion">;
export type ProductVersionStatus = "draft" | "in_review" | "published" | "retired";

const TRANSITIONS: Record<ProductVersionStatus, readonly ProductVersionStatus[]> = {
  draft: ["in_review"],
  in_review: ["draft", "published"],
  published: ["retired"],
  retired: [],
};

const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export interface ProductVersionProps {
  id: ProductVersionId;
  tenantId: TenantId;
  productId: ProductId;
  version: string;
  status: ProductVersionStatus;
  contents: VersionContents;
  basedOnId: ProductVersionId | null;
  createdAt: Instant;
  updatedAt: Instant;
  publishedAt: Instant | null;
  retiredAt: Instant | null;
}

export class ProductVersion extends AggregateRoot {
  private constructor(private props: ProductVersionProps) {
    super();
  }

  static draft(
    input: {
      tenantId: TenantId;
      productId: ProductId;
      version: string;
      basedOn?: ProductVersion;
    },
    clock: Clock,
  ): ProductVersion {
    const version = input.version.trim();

    if (!LABEL.test(version)) {
      throw invalid("Use up to 32 letters, digits, dots or dashes for the version, like 2027.1", {
        field: "version",
      });
    }

    if (input.basedOn && input.basedOn.props.productId !== input.productId) {
      throw invalid("Copy a version of the same product");
    }

    const now = clock.now();

    const draft = new ProductVersion({
      id: newId<"ProductVersion">(),
      tenantId: input.tenantId,
      productId: input.productId,
      version,
      status: "draft",
      contents: input.basedOn ? copyContents(input.basedOn.props.contents) : emptyContents(),
      basedOnId: input.basedOn?.id ?? null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      retiredAt: null,
    });

    draft.event("catalog.product_version_created", now, {
      productId: input.productId,
      version,
      basedOnId: draft.props.basedOnId,
    });

    return draft;
  }

  static restore(props: ProductVersionProps): ProductVersion {
    return new ProductVersion(props);
  }

  get id(): ProductVersionId {
    return this.props.id;
  }

  get status(): ProductVersionStatus {
    return this.props.status;
  }

  get contents(): Readonly<VersionContents> {
    return this.props.contents;
  }

  update(changes: Partial<VersionContents>, clock: Clock): void {
    if (this.props.status !== "draft") {
      throw new DomainError(
        "precondition_failed",
        `Version ${this.props.version} is ${this.props.status.replace("_", " ")}; only drafts can change`,
      );
    }

    this.props = {
      ...this.props,
      contents: { ...this.props.contents, ...changes },
      updatedAt: clock.now(),
    };
  }

  submitForReview(clock: Clock): void {
    this.transition("in_review", clock);
  }

  returnToDraft(clock: Clock): void {
    this.transition("draft", clock);
  }

  publish(issues: readonly CheckIssue[], releaseIds: readonly ProductReleaseId[], clock: Clock) {
    const blocking = issues.filter((issue) => issue.severity === "error");

    if (blocking.length > 0) {
      throw new DomainError(
        "precondition_failed",
        `Fix ${blocking.length === 1 ? "1 issue" : `${blocking.length} issues`} before publishing`,
        { issues: blocking },
      );
    }

    const now = this.transition("published", clock);
    this.props = { ...this.props, publishedAt: now };

    this.event("catalog.product_version_published", now, {
      productId: this.props.productId,
      version: this.props.version,
      releaseIds,
    });
  }

  retire(clock: Clock): void {
    const now = this.transition("retired", clock);
    this.props = { ...this.props, retiredAt: now };
  }

  toSnapshot(): Readonly<ProductVersionProps> {
    return { ...this.props };
  }

  private transition(to: ProductVersionStatus, clock: Clock): Instant {
    if (!TRANSITIONS[this.props.status].includes(to)) {
      throw new DomainError(
        "precondition_failed",
        `Can't move version ${this.props.version} from ${this.props.status.replace("_", " ")} to ${to.replace("_", " ")}`,
      );
    }

    const now = clock.now();
    this.props = { ...this.props, status: to, updatedAt: now };

    return now;
  }

  private event(type: string, occurredAt: Instant, payload: Record<string, unknown>) {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "product_version",
      aggregateId: this.props.id,
      occurredAt,
      payload,
    });
  }
}

function copyContents(contents: VersionContents): VersionContents {
  const { availability, ...json } = contents;

  return {
    ...structuredClone(json),
    availability: availability.map((window) => ({
      jurisdiction: { ...window.jurisdiction },
      newBusiness: { ...window.newBusiness },
      renewal: { ...window.renewal },
      ...(window.market && { market: window.market }),
    })),
  };
}
