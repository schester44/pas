import { makeVersionTransition, type VersionTransitionDeps } from "./version-transition";

export const makeRetireProductVersion = (deps: VersionTransitionDeps) =>
  makeVersionTransition(deps, (version, clock) => version.retire(clock));

export type RetireProductVersion = ReturnType<typeof makeRetireProductVersion>;
