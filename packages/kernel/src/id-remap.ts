import { newId } from "./id";

/** Gives copied rows fresh ids and rewrites every reference to them, including inside JSON config. */
export class IdRemap {
  private readonly ids = new Map<string, string>();

  id(old: string): string {
    let mapped = this.ids.get(old);

    if (!mapped) {
      mapped = newId();
      this.ids.set(old, mapped);
    }

    return mapped;
  }

  maybe(old: string | null): string | null {
    return old === null ? null : this.id(old);
  }

  rewrite<T>(value: T): T {
    if (typeof value === "string") return (this.ids.get(value) ?? value) as T;

    if (Array.isArray(value)) return value.map((item) => this.rewrite(item)) as T;

    if (value === null || typeof value !== "object") return value;

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, this.rewrite(item)]),
    ) as T;
  }
}
