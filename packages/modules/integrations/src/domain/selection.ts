import {
  allowsSeveral,
  type IntegrationCategory,
  type ProviderRules,
  usableInSandbox,
} from "./category";
import type { InstallProps } from "./install";

export interface Selected {
  providerId: string;
  installId: string | null;
}

/**
 * Which providers power a category's port for a tenant, in call order. Sandboxes drop anything
 * that could reach a live account; with nothing usable the built-in fake takes over.
 */
export function selectProviders(input: {
  category: IntegrationCategory;
  installs: readonly Readonly<InstallProps>[];
  providers: (id: string) => ProviderRules | undefined;
  fallback: string | null;
  sandbox: boolean;
}): Selected[] {
  const usable = input.installs.filter((install) => {
    const provider = input.providers(install.providerId);

    if (!provider || provider.category !== input.category || install.status === "disabled") {
      return false;
    }

    return !input.sandbox || usableInSandbox(provider, install.environment);
  });

  const ordered = usable.toSorted((a, b) =>
    allowsSeveral(input.category)
      ? a.position - b.position || compareEnabled(a, b)
      : compareEnabled(b, a),
  );

  const chosen = allowsSeveral(input.category) ? ordered : ordered.slice(0, 1);

  if (chosen.length > 0) {
    return chosen.map((install) => ({ providerId: install.providerId, installId: install.id }));
  }

  return input.fallback ? [{ providerId: input.fallback, installId: null }] : [];
}

const compareEnabled = (a: Readonly<InstallProps>, b: Readonly<InstallProps>) =>
  (a.enabledAt?.epochMilliseconds ?? 0) - (b.enabledAt?.epochMilliseconds ?? 0);
