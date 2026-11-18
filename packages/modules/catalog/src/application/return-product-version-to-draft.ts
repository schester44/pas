import { makeVersionTransition, type VersionTransitionDeps } from "./version-transition";

export const makeReturnProductVersionToDraft = (deps: VersionTransitionDeps) =>
  makeVersionTransition(deps, (version, clock) => version.returnToDraft(clock));

export type ReturnProductVersionToDraft = ReturnType<typeof makeReturnProductVersionToDraft>;
