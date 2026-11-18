import {
  type Clock,
  conflict,
  invalid,
  newId,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { editionLabel, parseEdition } from "../domain/edition";
import { FormEdition, type FormEditionId } from "../domain/form-edition";
import type { FormEditionRepository } from "../ports/form-edition-repository";
import type { PdfInspector } from "../ports/pdf-inspector";
import { type FormEditionDto, toFormEditionDto } from "./dto";

export const MAX_FORM_EDITION_BYTES = 20 * 1024 * 1024;

export interface UploadFormEditionInput {
  formNumber: string;
  edition: string;
  title: string;
  jurisdictions: string[];
  carrier?: string | null;
  file: Uint8Array;
}

const PDF_MAGIC = "%PDF-";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeUploadFormEdition(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  editions: FormEditionRepository;
  storage: ObjectStorage;
  pdf: PdfInspector;
  clock: Clock;
}) {
  return async function uploadFormEdition(
    ctx: TenantContext,
    input: UploadFormEditionInput,
  ): Promise<FormEditionDto> {
    const { file } = input;

    if (file.byteLength > MAX_FORM_EDITION_BYTES) {
      throw invalid("Upload a PDF smaller than 20 MB", { field: "file" });
    }

    const header = new TextDecoder().decode(file.subarray(0, 1024));
    const pageCount = header.includes(PDF_MAGIC) ? await deps.pdf.pageCount(file) : null;

    if (pageCount === null) throw invalid("Upload a PDF file", { field: "file" });

    const id = newId<"FormEdition">() as FormEditionId;
    const createdBy = ctx.actor.type === "user" ? ctx.actor.userId : ctx.actor.type;
    const storageKey = `tenants/${ctx.tenantId}/form-editions/${id}.pdf`;

    const edition = FormEdition.upload(
      {
        id,
        tenantId: ctx.tenantId,
        formNumber: input.formNumber,
        edition: parseEdition(input.edition),
        title: input.title,
        jurisdictions: input.jurisdictions,
        carrier: input.carrier ?? null,
        file: { storageKey, sha256: await sha256(file), pageCount, sizeBytes: file.byteLength },
        createdBy,
      },
      deps.clock,
    );

    const { formNumber, edition: parsed } = edition.toSnapshot();

    return deps.uow.run(ctx, async (tx) => {
      if (await deps.editions.exists(tx, ctx, formNumber, parsed)) {
        throw conflict(`${formNumber} ${editionLabel(parsed)} is already in the library`, {
          field: "edition",
        });
      }

      await deps.storage.put({ key: storageKey, body: file, contentType: "application/pdf" });
      await deps.editions.insert(tx, edition);
      await deps.outbox.add(tx, edition.pullEvents());

      return toFormEditionDto(edition);
    });
  };
}

export type UploadFormEdition = ReturnType<typeof makeUploadFormEdition>;
