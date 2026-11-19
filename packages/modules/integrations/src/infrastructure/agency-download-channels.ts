import type { AgencyDownloadChannels } from "@pas/agency-downloads";
import type { ProviderResolver } from "../application/provider-resolver";

/** The tenant's enabled agency downloads provider; none means downloads are off. */
export function agencyDownloadChannelsFrom(integrations: {
  resolver: ProviderResolver;
}): AgencyDownloadChannels {
  return {
    async active(ctx) {
      const [first] = await integrations.resolver.chain(ctx, "agency_downloads");

      return first?.adapter ?? null;
    },
  };
}
