import type { AddressSuggestion } from "@pas/addressing";
import type { TenantContext } from "@pas/kernel";
import type { AddressProviders } from "../ports/address-providers";

/** Typing suggestions from the first provider that offers them. Never stored (vendors.md §1.4). */
export function makeSuggestAddresses(deps: { providers: AddressProviders; timeoutMs?: number }) {
  return async function suggestAddresses(
    ctx: TenantContext,
    input: { text: string; selected?: string; country?: string; limit?: number },
  ): Promise<AddressSuggestion[]> {
    const providers = await deps.providers.for(ctx);

    // A suggestion-only provider is there to save verification lookups, so it suggests first.
    const suggester =
      providers.find((p) => p.suggest && !p.verify) ?? providers.find((p) => p.suggest);

    if (!suggester?.suggest || input.text.trim().length < 3) return [];

    return suggester.suggest(
      {
        text: input.text.trim(),
        selected: input.selected,
        country: input.country ?? "US",
        limit: input.limit ?? 6,
      },
      { signal: AbortSignal.timeout(deps.timeoutMs ?? 3000) },
    );
  };
}

export type SuggestAddresses = ReturnType<typeof makeSuggestAddresses>;
