import { editionKey, editionLabel } from "../domain/edition";
import type { FormEdition } from "../domain/form-edition";

export interface FormEditionDto {
  id: string;
  formNumber: string;
  edition: string;
  editionLabel: string;
  title: string;
  jurisdictions: string[];
  carrier: string | null;
  pageCount: number;
  sizeBytes: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

export function toFormEditionDto(edition: FormEdition): FormEditionDto {
  const e = edition.toSnapshot();

  return {
    id: e.id,
    formNumber: e.formNumber,
    edition: editionKey(e.edition),
    editionLabel: editionLabel(e.edition),
    title: e.title,
    jurisdictions: e.jurisdictions,
    carrier: e.carrier,
    pageCount: e.file.pageCount,
    sizeBytes: e.file.sizeBytes,
    sha256: e.file.sha256,
    createdBy: e.createdBy,
    createdAt: e.createdAt.toString(),
  };
}
