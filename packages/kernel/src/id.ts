import { v7 as uuidv7 } from "uuid";

/** Branded string id. `Id<"Product">` is not assignable to `Id<"Policy">`. */
export type Id<Brand extends string> = string & { readonly __idBrand: Brand };

export function newId<Brand extends string>(): Id<Brand> {
  return uuidv7() as Id<Brand>;
}

export function asId<Brand extends string>(value: string): Id<Brand> {
  return value as Id<Brand>;
}
