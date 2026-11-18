import {
  AggregateRoot,
  type Clock,
  conflict,
  type Id,
  type Instant,
  newId,
  type TenantId,
} from "@pas/kernel";
import {
  addressKey,
  type ClientKind,
  contactKeys,
  emailKey,
  type InsuredContact,
  nameKey,
  type PostalAddress,
} from "./contact";
import type { MatchCandidate } from "./matching";

export type ClientAccountId = Id<"ClientAccount">;
export type ClientAccountStatus = "active" | "merged";

export interface ClientEmail {
  address: string;
  key: string;
  verifiedAt: Instant | null;
}

export interface ClientPhone {
  number: string;
  key: string;
}

export interface ClientAccountProps {
  id: ClientAccountId;
  tenantId: TenantId;
  kind: ClientKind;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  emails: ClientEmail[];
  phones: ClientPhone[];
  mailingAddress: PostalAddress | null;
  status: ClientAccountStatus;
  mergedIntoId: ClientAccountId | null;
  invitedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

/** One insured person or business per tenant; policies link to it as parties (PLAN §7.7). */
export class ClientAccount extends AggregateRoot {
  private constructor(private props: ClientAccountProps) {
    super();
  }

  static restore(props: ClientAccountProps): ClientAccount {
    return new ClientAccount(props);
  }

  static open(tenantId: TenantId, contact: InsuredContact, clock: Clock): ClientAccount {
    const now = clock.now();

    const account = new ClientAccount({
      id: newId<"ClientAccount">(),
      tenantId,
      kind: contact.kind,
      displayName: contact.name.trim(),
      firstName: contact.firstName?.trim() || null,
      lastName: contact.lastName?.trim() || null,
      businessName: contact.businessName?.trim() || null,
      emails: [],
      phones: [],
      mailingAddress: contact.mailingAddress ?? null,
      status: "active",
      mergedIntoId: null,
      invitedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    account.absorb(contact, clock);
    account.emit("parties.client_account_opened", now, { displayName: account.displayName });

    return account;
  }

  get id(): ClientAccountId {
    return this.props.id;
  }

  get displayName(): string {
    return this.props.displayName;
  }

  get status(): ClientAccountStatus {
    return this.props.status;
  }

  get primaryEmail(): string | null {
    return this.props.emails[0]?.address ?? null;
  }

  hasEmail(key: string): boolean {
    return this.props.emails.some((e) => e.key === key);
  }

  keys(): MatchCandidate {
    return {
      id: this.props.id,
      kind: this.props.kind,
      nameKey: nameKey(this.props.displayName, this.props.kind),
      emailKeys: this.props.emails.map((e) => e.key),
      phoneKeys: this.props.phones.map((p) => p.key),
      addressKey: addressKey(this.props.mailingAddress),
    };
  }

  /** Adds contact details a producer captured that the account doesn't have yet. */
  absorb(contact: InsuredContact, clock: Clock): void {
    this.assertActive();

    const keys = contactKeys(contact);

    if (contact.email && keys.emailKeys[0] && !this.hasEmail(keys.emailKeys[0])) {
      this.props.emails.push({
        address: contact.email.trim(),
        key: keys.emailKeys[0],
        verifiedAt: null,
      });
    }

    if (
      contact.phone &&
      keys.phoneKeys[0] &&
      !this.props.phones.some((p) => p.key === keys.phoneKeys[0])
    ) {
      this.props.phones.push({ number: contact.phone.trim(), key: keys.phoneKeys[0] });
    }

    if (!this.props.mailingAddress && contact.mailingAddress) {
      this.props.mailingAddress = contact.mailingAddress;
    }

    this.props.firstName ??= contact.firstName?.trim() || null;
    this.props.lastName ??= contact.lastName?.trim() || null;
    this.props.updatedAt = clock.now();
  }

  /** The client proved control of the address (one-time code), so it now counts as verified. */
  verifyEmail(address: string, clock: Clock): void {
    const key = emailKey(address);

    if (!key) return;

    const existing = this.props.emails.find((e) => e.key === key);

    if (existing) {
      existing.verifiedAt ??= clock.now();
    } else {
      this.props.emails.push({ address: address.trim(), key, verifiedAt: clock.now() });
    }

    this.props.updatedAt = clock.now();
  }

  invite(policy: { id: string; number: string }, clock: Clock, resend = false): void {
    this.assertActive();

    const email = this.primaryEmail;

    if (!email) throw conflict(`${this.displayName} has no email address to invite`);

    const now = clock.now();
    this.props.invitedAt = now;
    this.props.updatedAt = now;

    this.emit("parties.client_invited", now, {
      clientAccountId: this.id,
      name: this.props.firstName ?? this.displayName,
      email,
      policyId: policy.id,
      policyNumber: policy.number,
      resend,
    });
  }

  /** Folds `other` into this account; the caller moves policy links and portal users. */
  absorbMerged(other: ClientAccount, clock: Clock): void {
    this.assertActive();
    other.assertActive();

    if (other.id === this.id) throw conflict("An account can't be merged into itself");

    if (other.props.kind !== this.props.kind) {
      throw conflict("A person and a business can't be merged");
    }

    for (const email of other.props.emails) {
      if (!this.hasEmail(email.key)) this.props.emails.push(email);
    }

    for (const phone of other.props.phones) {
      if (!this.props.phones.some((p) => p.key === phone.key)) this.props.phones.push(phone);
    }

    this.props.mailingAddress ??= other.props.mailingAddress;

    const now = clock.now();
    this.props.updatedAt = now;
    other.props.status = "merged";
    other.props.mergedIntoId = this.id;
    other.props.updatedAt = now;

    this.emit("parties.client_accounts_merged", now, {
      survivorId: this.id,
      mergedId: other.id,
      mergedName: other.displayName,
    });
  }

  toSnapshot(): Readonly<ClientAccountProps> {
    return this.props;
  }

  private assertActive(): void {
    if (this.props.status !== "active") {
      throw conflict(`${this.displayName} was merged into another account`);
    }
  }

  private emit(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "client_account",
      aggregateId: this.props.id,
      occurredAt,
      payload,
    });
  }
}
