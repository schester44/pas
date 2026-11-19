import type { DocumentSet } from "@pas/documents";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { Jurisdiction } from "@pas/kernel";
import type { BillingConfig } from "@pas/pay-plans";
import type { RatingConfig } from "@pas/rating-engine";
import {
  type AvailabilityWindowJson,
  availabilityFromJson,
  availabilityToJson,
  type DateWindowJson,
  dateWindowToJson,
} from "../domain/availability";
import type { CheckIssue } from "../domain/checks";
import type { CoverageDefinition } from "../domain/coverage";
import type { Product } from "../domain/product";
import type { ProductRelease, ReleaseManifest } from "../domain/product-release";
import type { ProductVersion } from "../domain/product-version";
import type {
  FormChannel,
  FormStage,
  VersionContents,
  VersionDecision,
} from "../domain/version-contents";

export interface ProductDto {
  id: string;
  key: string;
  name: string;
  lineOfBusiness: string;
  status: string;
  createdAt: string;
}

export function toProductDto(product: Product): ProductDto {
  const p = product.toSnapshot();

  return {
    id: p.id,
    key: p.key,
    name: p.name,
    lineOfBusiness: p.lineOfBusiness,
    status: p.status,
    createdAt: p.createdAt.toString(),
  };
}

export type AvailabilityWindowDto = AvailabilityWindowJson;

export interface AvailableProductDto extends ProductDto {
  availability: (DateWindowJson & { jurisdiction: Jurisdiction })[];
}

export interface VersionContentsDto {
  riskSchema: RiskSchema;
  forms: { channel: FormChannel; stage: FormStage; form: FormDefinition }[];
  coverages: CoverageDefinition[];
  availability: AvailabilityWindowDto[];
  lifecycle: Record<string, unknown>;
  documents: DocumentSet;
  rules: VersionDecision[];
  rating: RatingConfig | null;
  billing: BillingConfig;
}

export interface ProductVersionSummaryDto {
  id: string;
  productId: string;
  version: string;
  status: string;
  availability: AvailabilityWindowDto[];
  basedOnId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
}

export interface ProductVersionDto extends ProductVersionSummaryDto, VersionContentsDto {}

export interface ProductReleaseDto {
  id: string;
  productId: string;
  productVersionId: string;
  version: string;
  jurisdiction: Jurisdiction;
  newBusiness: DateWindowJson;
  renewal: DateWindowJson;
  contentHash: string;
  publishedAt: string;
}

export interface ResolvedReleaseDto extends ProductReleaseDto {
  manifest: ReleaseManifest;
}

export type CheckIssueDto = CheckIssue;

export function fromContentsDto(dto: Partial<VersionContentsDto>): Partial<VersionContents> {
  const { availability, ...rest } = dto;

  return availability ? { ...rest, availability: availability.map(availabilityFromJson) } : rest;
}

export function toVersionSummaryDto(version: ProductVersion): ProductVersionSummaryDto {
  const v = version.toSnapshot();

  return {
    id: v.id,
    productId: v.productId,
    version: v.version,
    status: v.status,
    availability: v.contents.availability.map(availabilityToJson),
    basedOnId: v.basedOnId,
    createdAt: v.createdAt.toString(),
    updatedAt: v.updatedAt.toString(),
    publishedAt: v.publishedAt?.toString() ?? null,
    retiredAt: v.retiredAt?.toString() ?? null,
  };
}

export function toVersionDto(version: ProductVersion): ProductVersionDto {
  const { riskSchema, forms, coverages, lifecycle, documents, rules, rating, billing } =
    version.contents;

  return {
    ...toVersionSummaryDto(version),
    riskSchema,
    forms,
    coverages,
    lifecycle,
    documents,
    rules,
    rating,
    billing,
  };
}

export function toReleaseDto(release: ProductRelease): ProductReleaseDto {
  const r = release.toSnapshot();

  return {
    id: r.id,
    productId: r.productId,
    productVersionId: r.productVersionId,
    version: r.version,
    jurisdiction: r.jurisdiction,
    newBusiness: dateWindowToJson(r.newBusiness),
    renewal: dateWindowToJson(r.renewal),
    contentHash: r.contentHash,
    publishedAt: r.publishedAt.toString(),
  };
}

export function toResolvedReleaseDto(release: ProductRelease): ResolvedReleaseDto {
  return { ...toReleaseDto(release), manifest: release.toSnapshot().manifest };
}
