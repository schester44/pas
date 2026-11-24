import { type ExtensionPoint, isExtensionPoint } from "@pas/extension-points";

/** A header the host attaches to requests for matching hosts, filled from the extension's secrets. */
export interface CredentialRule {
  host: string;
  header: string;
  /** e.g. `Bearer {{secrets.API_KEY}}` */
  value: string;
}

/** The PAS SDK an automation may call; each one has to be declared, like a token's scopes. */
export const AUTOMATION_SERVICES = ["pas.policy.addNote", "pas.email.send"] as const;
export type AutomationService = (typeof AUTOMATION_SERVICES)[number];

export interface ExtensionManifest {
  points: ExtensionPoint[];
  services: AutomationService[];
  allowedHosts: string[];
  credentials: CredentialRule[];
  /** Sandbox tenants answer network calls from recorded fixtures unless this is on. */
  liveInSandbox: boolean;
  limits: { memoryMb?: number; cpuMs?: number };
}

export const ENTRY_FILE = "index.ts";

export const emptyManifest = (): ExtensionManifest => ({
  points: [],
  services: [],
  allowedHosts: [],
  credentials: [],
  liveInSandbox: false,
  limits: {},
});

export const MAX_MEMORY_MB = 128;
export const MAX_CPU_MS = 2_000;

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const SECRET_REF = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection"]);

/** Each point calls the export named after it: `field_options` → `fieldOptions`. */
export const exportNameFor = (point: ExtensionPoint): string =>
  point.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export const secretReferences = (template: string): string[] =>
  [...template.matchAll(SECRET_REF)].map((m) => m[1]!);

export function renderCredential(template: string, secrets: Readonly<Record<string, string>>) {
  return template.replace(SECRET_REF, (_, name: string) => secrets[name] ?? "");
}

export function checkManifest(
  manifest: ExtensionManifest,
  secretNames: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];

  if (manifest.points.length === 0) issues.push("Choose at least one extension point");

  for (const point of manifest.points) {
    if (!isExtensionPoint(point)) issues.push(`${String(point)} isn't an extension point`);
  }

  if (new Set(manifest.points).size !== manifest.points.length)
    issues.push("A point is listed twice");

  for (const service of manifest.services) {
    if (!(AUTOMATION_SERVICES as readonly string[]).includes(service)) {
      issues.push(`${String(service)} isn't part of the PAS SDK`);
    }
  }

  if (manifest.services.length > 0 && !manifest.points.includes("automation")) {
    issues.push("Only automation extensions can call the PAS SDK");
  }

  for (const host of manifest.allowedHosts) {
    if (!HOST.test(host))
      issues.push(`${host} isn't a host name (like api.example.com or *.example.com)`);
  }

  for (const rule of manifest.credentials) {
    if (!manifest.allowedHosts.includes(rule.host)) {
      issues.push(`Credentials for ${rule.host} need it in the allowed hosts`);
    }

    if (!HEADER.test(rule.header) || FORBIDDEN_HEADERS.has(rule.header.toLowerCase())) {
      issues.push(`${rule.header} can't be used as a credential header`);
    }

    for (const name of secretReferences(rule.value)) {
      if (!secretNames.has(name))
        issues.push(`The ${rule.header} header uses a secret ${name} that isn't set`);
    }
  }

  if ((manifest.limits.memoryMb ?? 0) > MAX_MEMORY_MB) {
    issues.push(`Extensions can use at most ${MAX_MEMORY_MB} MB`);
  }

  if ((manifest.limits.cpuMs ?? 0) > MAX_CPU_MS) {
    issues.push(`Extensions can use at most ${MAX_CPU_MS}ms of CPU`);
  }

  return issues;
}
