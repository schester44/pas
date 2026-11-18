import {
  AggregateRoot,
  type Clock,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import type { WorkbookReport } from "@pas/rating-engine";

export type RaterWorkbookId = Id<"RaterWorkbook">;

export interface StoredWorkbook {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface RaterWorkbookProps {
  id: RaterWorkbookId;
  tenantId: TenantId;
  name: string;
  fileName: string;
  file: StoredWorkbook;
  report: WorkbookReport;
  createdBy: string;
  createdAt: Instant;
}

const squash = (text: string) => text.trim().replace(/\s+/g, " ");

export class RaterWorkbook extends AggregateRoot {
  private constructor(private readonly props: RaterWorkbookProps) {
    super();
  }

  static upload(input: Omit<RaterWorkbookProps, "createdAt">, clock: Clock): RaterWorkbook {
    const name = squash(input.name);

    if (!name || name.length > 200) throw invalid("Name the workbook", { field: "name" });

    if (!input.report.ok) {
      throw invalid("This workbook can't be used for rating", {
        field: "file",
        report: input.report,
      });
    }

    const workbook = new RaterWorkbook({ ...input, name, createdAt: clock.now() });

    workbook.record({
      id: newId(),
      type: "rating.rater_workbook_uploaded",
      tenantId: input.tenantId,
      aggregateType: "rater_workbook",
      aggregateId: input.id,
      occurredAt: workbook.props.createdAt,
      payload: { sha256: input.file.sha256 },
    });

    return workbook;
  }

  static restore(props: RaterWorkbookProps): RaterWorkbook {
    return new RaterWorkbook(props);
  }

  get id(): RaterWorkbookId {
    return this.props.id;
  }

  toSnapshot(): Readonly<RaterWorkbookProps> {
    return this.props;
  }
}
