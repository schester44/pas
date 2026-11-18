import {
  AggregateRoot,
  type Clock,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import type { Edition } from "./edition";

export type FormEditionId = Id<"FormEdition">;

export interface StoredFile {
  storageKey: string;
  sha256: string;
  pageCount: number;
  sizeBytes: number;
}

export interface FormEditionProps {
  id: FormEditionId;
  tenantId: TenantId;
  formNumber: string;
  edition: Edition;
  title: string;
  jurisdictions: string[];
  carrier: string | null;
  file: StoredFile;
  createdBy: string;
  createdAt: Instant;
}

const JURISDICTION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

const squash = (text: string) => text.trim().replace(/\s+/g, " ");

export class FormEdition extends AggregateRoot {
  private constructor(private readonly props: FormEditionProps) {
    super();
  }

  static upload(
    input: Omit<FormEditionProps, "createdAt" | "carrier"> & { carrier?: string | null },
    clock: Clock,
  ): FormEdition {
    const formNumber = squash(input.formNumber).toUpperCase();
    const title = squash(input.title);
    const carrier = input.carrier ? squash(input.carrier) : null;

    const jurisdictions = [
      ...new Set(input.jurisdictions.map((code) => code.trim().toUpperCase())),
    ];

    if (!formNumber || formNumber.length > 40) {
      throw invalid("Enter the form number, like HO 00 03", { field: "formNumber" });
    }

    if (!title || title.length > 200) throw invalid("Enter the form title", { field: "title" });

    if (carrier && carrier.length > 200)
      throw invalid("Shorten the carrier name", { field: "carrier" });

    const bad = jurisdictions.find((code) => !JURISDICTION.test(code));

    if (bad) throw invalid(`${bad} isn't a jurisdiction code`, { field: "jurisdictions" });

    if (input.file.pageCount < 1) throw invalid("This PDF has no pages", { field: "file" });

    const edition = new FormEdition({
      ...input,
      formNumber,
      title,
      carrier,
      jurisdictions: jurisdictions.toSorted(),
      createdAt: clock.now(),
    });

    edition.record({
      id: newId(),
      type: "documents.form_edition_uploaded",
      tenantId: input.tenantId,
      aggregateType: "form_edition",
      aggregateId: input.id,
      occurredAt: edition.props.createdAt,
      payload: { formNumber, sha256: input.file.sha256 },
    });

    return edition;
  }

  static restore(props: FormEditionProps): FormEdition {
    return new FormEdition(props);
  }

  get id(): FormEditionId {
    return this.props.id;
  }

  toSnapshot(): Readonly<FormEditionProps> {
    return this.props;
  }
}
