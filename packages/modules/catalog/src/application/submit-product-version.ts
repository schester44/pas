import { makeVersionTransition, type VersionTransitionDeps } from "./version-transition";

export const makeSubmitProductVersion = (deps: VersionTransitionDeps) =>
  makeVersionTransition(deps, (version, clock) => version.submitForReview(clock));

export type SubmitProductVersion = ReturnType<typeof makeSubmitProductVersion>;
