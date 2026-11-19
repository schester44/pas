import { type Id, invalid, newId, type TenantId } from "@pas/kernel";

export type LicenseeId = Id<"Licensee">;

/** A surplus lines licensee of record in one state (PLAN §17.2.3); NIPR verification comes with distribution. */
export interface Licensee {
  id: LicenseeId;
  tenantId: TenantId;
  name: string;
  licenseNumber: string;
  jurisdiction: string;
  active: boolean;
}

const SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

export function licensee(input: Omit<Licensee, "id"> & { id?: string }): Licensee {
  const name = input.name.trim();
  const licenseNumber = input.licenseNumber.trim();

  if (!name) throw invalid("Enter the licensee's name");

  if (!licenseNumber) throw invalid("Enter the license number");

  if (!SUBDIVISION.test(input.jurisdiction)) throw invalid("Choose the state the license is for");

  return { ...input, id: (input.id ?? newId()) as LicenseeId, name, licenseNumber };
}

/** The active licensee licensed in the home state, if there is one. */
export const licenseeFor = (licensees: readonly Licensee[], homeState: string) =>
  licensees.find((l) => l.active && l.jurisdiction === homeState) ?? null;
