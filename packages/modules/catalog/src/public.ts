// Public surface of the catalog module. Other modules and apps import only from here.
export {
  makeCreateProduct,
  type CreateProduct,
  type CreateProductInput,
} from "./application/create-product";
export { makeListProducts, type ListProducts } from "./application/list-products";
export { makeGetProduct, type GetProduct } from "./application/get-product";
export {
  makeListProductVersions,
  type ListProductVersions,
} from "./application/list-product-versions";
export { makeGetProductVersion, type GetProductVersion } from "./application/get-product-version";
export {
  makeCreateProductVersion,
  type CreateProductVersion,
  type CreateProductVersionInput,
} from "./application/create-product-version";
export {
  makeUpdateProductVersion,
  type UpdateProductVersion,
  type UpdateProductVersionInput,
} from "./application/update-product-version";
export {
  makeSubmitProductVersion,
  type SubmitProductVersion,
} from "./application/submit-product-version";
export {
  makeReturnProductVersionToDraft,
  type ReturnProductVersionToDraft,
} from "./application/return-product-version-to-draft";
export {
  makeRetireProductVersion,
  type RetireProductVersion,
} from "./application/retire-product-version";
export {
  makeCheckProductVersion,
  type CheckProductVersion,
} from "./application/check-product-version";
export {
  makePublishProductVersion,
  type PublishProductVersion,
} from "./application/publish-product-version";
export {
  makeListProductReleases,
  type ListProductReleases,
} from "./application/list-product-releases";
export {
  makeResolveRelease,
  type ResolveRelease,
  type ResolveReleaseInput,
} from "./application/resolve-release";
export { makeGetProductRelease, type GetProductRelease } from "./application/get-product-release";
export {
  makeListAvailableProducts,
  type ListAvailableProducts,
  type ListAvailableProductsInput,
} from "./application/list-available-products";
export type {
  AvailableProductDto,
  AvailabilityWindowDto,
  CheckIssueDto,
  ProductDto,
  ProductReleaseDto,
  ProductVersionDto,
  ProductVersionSummaryDto,
  ResolvedReleaseDto,
  VersionContentsDto,
} from "./application/dto";
export type { CheckTarget } from "./domain/checks";
export {
  DECISION_CONTEXT_PATHS,
  decisionInputPaths,
  runDecisionTest,
  type DecisionTestResult,
} from "./domain/rule-checks";
export type {
  CoverageAmount,
  CoverageAttachment,
  CoverageDefinition,
  CoverageOptionSet,
} from "./domain/coverage";
export type { ReleaseManifest } from "./domain/product-release";
export type { ProductVersionStatus } from "./domain/product-version";
export {
  decisionRef,
  FORM_CHANNELS,
  FORM_STAGES,
  type DecisionTest,
  type FormChannel,
  type FormStage,
  type VersionDecision,
} from "./domain/version-contents";
export { MARKETS, type AvailabilityKind, type Market } from "./domain/availability";
export type { ProductRepository } from "./ports/product-repository";
export type { ProductVersionRepository } from "./ports/product-version-repository";
export type { ProductReleaseRepository } from "./ports/product-release-repository";
export type { FormEditionDirectory } from "./ports/form-edition-directory";
export type {
  RatingIssue,
  RatingSection,
  RatingTarget,
  RatingVerifier,
} from "./ports/rating-verifier";
export type { CarrierVerifier } from "./ports/carrier-verifier";
export type { ExtensionVerifier } from "./ports/extension-verifier";
