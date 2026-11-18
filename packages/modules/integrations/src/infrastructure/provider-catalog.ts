import { INTEGRATION_CATEGORIES, type IntegrationCategory } from "../domain/category";
import type { AnyProviderPackage, ProviderCatalog } from "../ports/provider-catalog";

export class StaticProviderCatalog implements ProviderCatalog {
  private readonly byId: Map<string, AnyProviderPackage>;

  constructor(packages: readonly AnyProviderPackage[]) {
    this.byId = new Map();

    for (const pkg of packages) {
      if (this.byId.has(pkg.manifest.id)) throw new Error(`Duplicate provider ${pkg.manifest.id}`);

      this.byId.set(pkg.manifest.id, pkg);
    }
  }

  list(): readonly AnyProviderPackage[] {
    return [...this.byId.values()].toSorted(
      (a, b) =>
        INTEGRATION_CATEGORIES.indexOf(a.manifest.category) -
          INTEGRATION_CATEGORIES.indexOf(b.manifest.category) ||
        Number(a.manifest.builtin) - Number(b.manifest.builtin) ||
        a.manifest.name.localeCompare(b.manifest.name),
    );
  }

  get(id: string): AnyProviderPackage | undefined {
    return this.byId.get(id);
  }

  builtinFor(category: IntegrationCategory): string | null {
    return (
      this.list().find((p) => p.manifest.category === category && p.manifest.builtin)?.manifest
        .id ?? null
    );
  }
}
