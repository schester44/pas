import type { ExtensionPoint } from "@pas/extension-points";
import type { Extension, ExtensionDraft } from "../domain/extension";
import type { ExtensionManifest } from "../domain/manifest";
import type { ExtensionRun } from "../domain/run";
import type { StoredSecret } from "../domain/secret";
import type { AutomationSubscription } from "../domain/subscription";
import type { ExtensionTest, TestReport } from "../domain/test-case";
import type { ExtensionVersion } from "../domain/version";

export interface ExtensionDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  points: ExtensionPoint[];
  latestVersion: number;
  updatedAt: string;
}

export interface ExtensionVersionDto {
  id: string;
  extensionId: string;
  version: number;
  points: ExtensionPoint[];
  allowedHosts: string[];
  contentHash: string;
  testReport: TestReport;
  note: string | null;
  publishedAt: string;
}

export interface ExtensionVersionDetailDto extends ExtensionVersionDto {
  source: Record<string, string>;
  manifest: ExtensionManifest;
  tests: ExtensionTest[];
}

export interface SubscriptionDto {
  id: string;
  extensionId: string;
  extensionVersionId: string;
  eventTypes: string[];
  condition: string | null;
  enabled: boolean;
  updatedAt: string;
}

export interface ExtensionDetailDto extends ExtensionDto {
  draft: ExtensionDraft;
  versions: ExtensionVersionDto[];
  secrets: { name: string; hint: string; updatedAt: string }[];
  subscriptions: SubscriptionDto[];
}

export interface ExtensionRunDto {
  id: string;
  extensionId: string;
  extensionVersionId: string | null;
  version: number | null;
  point: ExtensionPoint;
  trigger: string;
  subject: { type: string; id: string } | null;
  status: string;
  error: { code: string; message: string } | null;
  stats: { cpuMs: number; wallMs: number; hostCalls: number };
  createdAt: string;
}

export interface ExtensionRunDetailDto extends ExtensionRunDto {
  input: unknown;
  output: unknown;
  network: ExtensionRun["network"];
  logs: ExtensionRun["logs"];
}

export function toExtensionDto(extension: Extension): ExtensionDto {
  const e = extension.toSnapshot();

  return {
    id: e.id,
    key: e.key,
    name: e.name,
    description: e.description,
    status: e.status,
    points: e.draft.manifest.points,
    latestVersion: e.latestVersion,
    updatedAt: e.updatedAt.toString(),
  };
}

export function toVersionDto(version: ExtensionVersion): ExtensionVersionDto {
  return {
    id: version.id,
    extensionId: version.extensionId,
    version: version.version,
    points: version.manifest.points,
    allowedHosts: version.manifest.allowedHosts,
    contentHash: version.contentHash,
    testReport: version.testReport,
    note: version.note,
    publishedAt: version.publishedAt.toString(),
  };
}

export const toVersionDetailDto = (version: ExtensionVersion): ExtensionVersionDetailDto => ({
  ...toVersionDto(version),
  source: version.source,
  manifest: version.manifest,
  tests: version.tests,
});

export const toSubscriptionDto = (s: AutomationSubscription): SubscriptionDto => ({
  id: s.id,
  extensionId: s.extensionId,
  extensionVersionId: s.extensionVersionId,
  eventTypes: s.eventTypes,
  condition: s.condition,
  enabled: s.enabled,
  updatedAt: s.updatedAt.toString(),
});

export const toSecretDto = (s: StoredSecret) => ({
  name: s.name,
  hint: s.hint,
  updatedAt: s.updatedAt,
});

export const toRunDto = (run: ExtensionRun): ExtensionRunDto => ({
  id: run.id,
  extensionId: run.extensionId,
  extensionVersionId: run.extensionVersionId,
  version: run.version,
  point: run.point,
  trigger: run.trigger,
  subject: run.subject,
  status: run.status,
  error: run.error,
  stats: run.stats,
  createdAt: run.createdAt.toString(),
});

export const toRunDetailDto = (run: ExtensionRun): ExtensionRunDetailDto => ({
  ...toRunDto(run),
  input: run.input,
  output: run.output,
  network: run.network,
  logs: run.logs,
});
