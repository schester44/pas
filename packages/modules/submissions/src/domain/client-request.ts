import {
  AggregateRoot,
  type Clock,
  conflict,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";

export type ClientRequestId = Id<"ClientRequest">;

export type ClientRequestStatus = "sent" | "opened" | "completed" | "revoked" | "expired";

export interface ClientRequestProps {
  id: ClientRequestId;
  tenantId: TenantId;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  /** The submission's producer: the insured acts within that producer's book. */
  producerId: string;
  email: string;
  name: string;
  sentBy: { userId: string | null; name: string };
  sentAt: Instant;
  openedAt: Instant | null;
  completedAt: Instant | null;
  revokedAt: Instant | null;
  expiresAt: Instant;
  createdAt: Instant;
  updatedAt: Instant;
}

export const normalizedEmail = (email: string) => email.trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A link the producer sends so the insured completes their part of the application themselves. */
export class ClientRequest extends AggregateRoot {
  private constructor(private props: ClientRequestProps) {
    super();
  }

  static send(
    input: Pick<
      ClientRequestProps,
      | "tenantId"
      | "quoteId"
      | "submissionId"
      | "submissionNumber"
      | "producerId"
      | "name"
      | "sentBy"
      | "expiresAt"
    > & { email: string },
    clock: Clock,
  ): ClientRequest {
    const email = normalizedEmail(input.email);

    if (!EMAIL.test(email)) throw invalid("Enter a valid email address", { field: "email" });

    const now = clock.now();

    const request = new ClientRequest({
      ...input,
      id: newId() as ClientRequestId,
      email,
      name: input.name.trim(),
      sentAt: now,
      openedAt: null,
      completedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    request.announce(now, false);

    return request;
  }

  static restore(props: ClientRequestProps): ClientRequest {
    return new ClientRequest(props);
  }

  get id(): ClientRequestId {
    return this.props.id;
  }

  status(now: Instant): ClientRequestStatus {
    if (this.props.revokedAt) return "revoked";

    if (this.props.completedAt) return "completed";

    if (Temporal.Instant.compare(now, this.props.expiresAt) >= 0) return "expired";

    return this.props.openedAt ? "opened" : "sent";
  }

  isFor(email: string): boolean {
    return normalizedEmail(email) === this.props.email;
  }

  /** Throws unless the link still works; the caller has already checked who is using it. */
  assertUsable(clock: Clock): void {
    const status = this.status(clock.now());

    if (status === "sent" || status === "opened") return;

    const message = {
      completed: "This application is already complete",
      revoked: "This link was replaced by a newer one. Use the latest email from your agent.",
      expired: "This link has expired. Ask your agent to send a new one.",
    }[status];

    throw conflict(message, { reason: `request_${status}` });
  }

  resend(sentBy: ClientRequestProps["sentBy"], clock: Clock): void {
    this.assertUsable(clock);

    const now = clock.now();
    this.props = { ...this.props, sentBy, sentAt: now, updatedAt: now };
    this.announce(now, true);
  }

  markOpened(clock: Clock): boolean {
    if (this.props.openedAt) return false;

    const now = clock.now();
    this.props = { ...this.props, openedAt: now, updatedAt: now };

    return true;
  }

  complete(clock: Clock): void {
    if (this.props.completedAt) return;

    const now = clock.now();
    this.props = { ...this.props, completedAt: now, updatedAt: now };
  }

  revoke(clock: Clock): void {
    if (this.props.revokedAt || this.props.completedAt) return;

    const now = clock.now();
    this.props = { ...this.props, revokedAt: now, updatedAt: now };
  }

  toSnapshot(): Readonly<ClientRequestProps> {
    return this.props;
  }

  private announce(occurredAt: Instant, resend: boolean): void {
    this.record({
      id: newId(),
      type: "submissions.client_request_sent",
      tenantId: this.props.tenantId,
      aggregateType: "client_request",
      aggregateId: this.props.id,
      occurredAt,
      payload: {
        requestId: this.props.id,
        submissionId: this.props.submissionId,
        submissionNumber: this.props.submissionNumber,
        email: this.props.email,
        name: this.props.name,
        sentBy: this.props.sentBy.name,
        resend,
      },
    });
  }
}
