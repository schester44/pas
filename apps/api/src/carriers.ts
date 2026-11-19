import {
  type CarrierCompositionDeps,
  type CarrierSources,
  composeCarriers,
  feedSourceFrom,
  carrierGateways,
  MockCarrier,
} from "@pas/carriers/infrastructure";

/** Carriers for apps/api, plus the gateways submissions and policy call. */
export function composeApiCarriers(
  deps: Omit<CarrierCompositionDeps, "feedSource"> & { sources: CarrierSources },
) {
  const carriers = composeCarriers({ ...deps, feedSource: feedSourceFrom(deps.sources) });

  return { ...carriers, ...carrierGateways(carriers) };
}

export type ApiCarriers = ReturnType<typeof composeApiCarriers>;

/** The dev and sandbox mock carrier; signed callbacks go back through the public API. */
export function mockCarrier() {
  return new MockCarrier({
    deliver: async (url, body, signature) => {
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-carrier-signature": `sha256=${signature}`,
        },
        body,
      });
    },
  });
}
