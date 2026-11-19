import { type Audience, DEFAULT_IN_APP, type PublicEventType, STAFF_ONLY } from "./event-types";

export interface Member {
  userId: string;
  audience: Audience;
}

export function inAppTypesFor(audience: Audience, chosen: readonly string[] | null): string[] {
  const types = chosen ?? DEFAULT_IN_APP[audience];

  return audience === "producer"
    ? types.filter((type) => !(STAFF_ONLY as readonly string[]).includes(type))
    : [...types];
}

/** Staff hear about the whole book; producers only about their own production (PLAN §5.7). */
export function recipientsOf(input: {
  type: PublicEventType;
  producerId: string | null;
  members: readonly Member[];
  preferences: ReadonlyMap<string, readonly string[]>;
}): string[] {
  return input.members
    .filter((member) => {
      const wanted = inAppTypesFor(member.audience, input.preferences.get(member.userId) ?? null);

      if (!wanted.includes(input.type)) return false;

      return member.audience === "staff" || member.userId === input.producerId;
    })
    .map((member) => member.userId);
}
