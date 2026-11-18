import type { ProviderRules } from "../domain/category";
import type { ProviderManifest } from "../ports/provider-catalog";

export const rulesOf = (manifest: ProviderManifest): ProviderRules => ({
  id: manifest.id,
  category: manifest.category,
  testMode: manifest.testMode,
  liveMode: manifest.liveMode,
  builtin: manifest.builtin,
  requiredSecrets: manifest.secrets.filter((s) => !s.optional).map((s) => s.key),
});

export const secretContext = (tenantId: string, installId: string, key: string) =>
  `${tenantId}:${installId}:${key}`;
