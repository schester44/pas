import {
  AggregateRoot,
  type Clock,
  conflict,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import { emptyManifest, ENTRY_FILE, type ExtensionManifest } from "./manifest";
import type { ExtensionTest } from "./test-case";

export type ExtensionId = Id<"Extension">;
export type ExtensionStatus = "active" | "archived";

export interface ExtensionDraft {
  files: Record<string, string>;
  manifest: ExtensionManifest;
  tests: ExtensionTest[];
}

export interface ExtensionProps {
  id: ExtensionId;
  tenantId: TenantId;
  key: string;
  name: string;
  description: string | null;
  status: ExtensionStatus;
  draft: ExtensionDraft;
  latestVersion: number;
  createdAt: Instant;
  updatedAt: Instant;
}

const KEY = /^[a-z][a-z0-9-]{1,47}$/;
const FILE_NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.ts$/;
const MAX_FILES = 50;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_TESTS = 100;

const STARTER = `// Each extension point calls the export named after it (field_options → fieldOptions).
// ctx.fetch reaches the allowed hosts; ctx.clock.now() is the only clock.
export async function validate(input: { risk: Record<string, unknown> }) {
  return { issues: [] };
}
`;

function checkFiles(files: Record<string, string>) {
  const names = Object.keys(files);

  if (!(ENTRY_FILE in files))
    throw invalid(`The extension needs an ${ENTRY_FILE}`, { field: "files" });

  if (names.length > MAX_FILES) throw invalid(`Use at most ${MAX_FILES} files`, { field: "files" });

  const bad = names.find((name) => !FILE_NAME.test(name));

  if (bad) throw invalid(`${bad} isn't a valid file name (like lib/rates.ts)`, { field: "files" });

  const size = Object.values(files).reduce((sum, text) => sum + text.length, 0);

  if (size > MAX_SOURCE_BYTES)
    throw invalid("The source is larger than 512 KB", { field: "files" });
}

export class Extension extends AggregateRoot {
  private constructor(private props: ExtensionProps) {
    super();
  }

  static create(
    input: { tenantId: TenantId; key: string; name: string; description?: string | null },
    clock: Clock,
  ): Extension {
    const key = input.key.trim();
    const name = input.name.trim();

    if (!KEY.test(key)) {
      throw invalid(
        "Use 2–48 lowercase letters, digits or dashes for the key, like vehicle-lookup",
        {
          field: "key",
        },
      );
    }

    if (!name) throw invalid("Name the extension", { field: "name" });

    const now = clock.now();

    return new Extension({
      id: newId<"Extension">(),
      tenantId: input.tenantId,
      key,
      name,
      description: input.description?.trim() || null,
      status: "active",
      draft: {
        files: { [ENTRY_FILE]: STARTER },
        manifest: { ...emptyManifest(), points: ["validate"] },
        tests: [],
      },
      latestVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: ExtensionProps): Extension {
    return new Extension(props);
  }

  get id(): ExtensionId {
    return this.props.id;
  }

  get key(): string {
    return this.props.key;
  }

  get draft(): Readonly<ExtensionDraft> {
    return this.props.draft;
  }

  get latestVersion(): number {
    return this.props.latestVersion;
  }

  describe(input: { name: string; description: string | null }, clock: Clock): void {
    const name = input.name.trim();

    if (!name) throw invalid("Name the extension", { field: "name" });

    this.props = {
      ...this.props,
      name,
      description: input.description?.trim() || null,
      updatedAt: clock.now(),
    };
  }

  editDraft(changes: Partial<ExtensionDraft>, clock: Clock): void {
    this.assertActive();

    const draft = { ...this.props.draft, ...changes };

    checkFiles(draft.files);

    if (draft.tests.length > MAX_TESTS) throw invalid(`Keep at most ${MAX_TESTS} tests`);

    this.props = { ...this.props, draft, updatedAt: clock.now() };
  }

  /** Records that the draft was published as the next version. */
  published(input: { versionId: string; version: number }, clock: Clock): void {
    this.assertActive();

    if (input.version !== this.props.latestVersion + 1) {
      throw conflict("Another version was published meanwhile; publish again", {
        reason: "version_race",
      });
    }

    const now = clock.now();

    this.props = { ...this.props, latestVersion: input.version, updatedAt: now };

    this.record({
      id: newId(),
      type: "extensions.version_published",
      tenantId: this.props.tenantId,
      aggregateType: "extension",
      aggregateId: this.props.id,
      occurredAt: now,
      payload: { key: this.props.key, versionId: input.versionId, version: input.version },
    });
  }

  archive(clock: Clock): void {
    this.props = { ...this.props, status: "archived", updatedAt: clock.now() };
  }

  restoreFromArchive(clock: Clock): void {
    this.props = { ...this.props, status: "active", updatedAt: clock.now() };
  }

  toSnapshot(): Readonly<ExtensionProps> {
    return { ...this.props };
  }

  private assertActive() {
    if (this.props.status !== "active") {
      throw conflict(`${this.props.name} is archived; restore it to change it`, {
        reason: "extension_archived",
      });
    }
  }
}
