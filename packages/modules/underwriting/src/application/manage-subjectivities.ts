import {
  invalid,
  jurisdictionTimeZone,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import type { Person } from "../domain/referral";
import { Subjectivity } from "../domain/subjectivity";
import type { AddedSubjectivity } from "./approve-referral";
import { clockOf, loadSubjectivity, persist, personOf, type UnderwritingDeps } from "./deps";
import { type SubjectivityDto, toSubjectivityDto } from "./dto";

const MAX_BYTES = 5 * 1024 * 1024;
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").slice(-120);

/** Subjectivities: listing, underwriter additions, documents from the producer, and clearing them. */
export function makeManageSubjectivities(deps: UnderwritingDeps) {
  const today = (ctx: TenantContext) => clockOf(deps, ctx).today("UTC");

  const dtos = (ctx: TenantContext, list: Subjectivity[]) =>
    list.map((s) => toSubjectivityDto(s, today(ctx)));

  async function cleared(
    tx: Transaction,
    ctx: TenantContext,
    s: Subjectivity,
    by: Person,
    verb: string,
  ) {
    const snap = s.toSnapshot();

    await persist(deps, tx, s);

    await deps.timeline.record(tx, ctx, {
      quoteId: snap.quoteId,
      policyId: snap.policyId,
      type: "subjectivity_cleared",
      actor: { type: by.id ? "user" : "system", ...(by.id && { id: by.id }), name: by.name },
      summary: `${snap.title} ${verb} by ${by.name}`,
      data: { subjectivityId: snap.id, status: snap.status },
    });
  }

  return {
    async forQuote(ctx: TenantContext, input: { quoteId: string }): Promise<SubjectivityDto[]> {
      return dtos(
        ctx,
        await deps.uow.run(ctx, (tx) => deps.subjectivities.listByQuote(tx, ctx, input.quoteId)),
      );
    },

    async forPolicy(ctx: TenantContext, input: { policyId: string }): Promise<SubjectivityDto[]> {
      return dtos(
        ctx,
        await deps.uow.run(ctx, (tx) => deps.subjectivities.listByPolicy(tx, ctx, input.policyId)),
      );
    },

    /** Open subjectivities across the book, overdue first, for the workbench. */
    async open(ctx: TenantContext): Promise<SubjectivityDto[]> {
      const list = dtos(
        ctx,
        await deps.uow.run(ctx, (tx) => deps.subjectivities.listOpen(tx, ctx, 300)),
      );

      return list.toSorted(
        (a, b) =>
          Number(b.overdue) - Number(a.overdue) ||
          (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"),
      );
    },

    async add(
      ctx: TenantContext,
      input: AddedSubjectivity & { submissionId: string; actorName: string },
    ): Promise<SubjectivityDto> {
      if (!input.title.trim()) throw invalid("Describe the subjectivity", { field: "title" });

      const facts = await deps.quotes.facts(ctx, { submissionId: input.submissionId });
      const by = personOf(ctx, input.actorName);
      const clock = clockOf(deps, ctx);

      const boundOn =
        facts.policy && facts.boundAt
          ? facts.boundAt.toZonedDateTimeISO(jurisdictionTimeZone(facts.jurisdiction)).toPlainDate()
          : undefined;

      if (boundOn && input.timing === "pre_bind") {
        throw invalid("The policy is already bound; add a post-bind subjectivity", {
          field: "timing",
        });
      }

      return deps.uow.run(ctx, async (tx) => {
        const settings = await deps.settings.get(tx, ctx);

        const s = Subjectivity.create(
          {
            tenantId: ctx.tenantId,
            quoteId: facts.quoteId,
            submissionId: facts.submissionId,
            submissionNumber: facts.submissionNumber,
            policyId: facts.policy?.id ?? null,
            policyNumber: facts.policy?.number ?? null,
            referralId: null,
            inspectionId: null,
            code: `UW-${newId().slice(-6).toUpperCase()}`,
            title: input.title.trim(),
            description: input.description?.trim() || null,
            timing: input.timing,
            dueDays: input.dueDays ?? null,
            owner: input.owner,
            source: "underwriter",
            consequence: settings.overdueConsequence,
          },
          by,
          clock,
          boundOn,
        );

        await persist(deps, tx, s);

        await deps.timeline.record(tx, ctx, {
          quoteId: facts.quoteId,
          policyId: facts.policy?.id ?? null,
          type: "subjectivity_added",
          actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
          summary: `Subjectivity added: ${s.toSnapshot().title}`,
          data: { subjectivityId: s.id },
        });

        return toSubjectivityDto(s, today(ctx));
      });
    },

    async upload(
      ctx: TenantContext,
      input: { id: string; name: string; contentType: string; body: Uint8Array; actorName: string },
    ): Promise<SubjectivityDto> {
      if (input.body.byteLength > MAX_BYTES) throw invalid("Files can be up to 5 MB");

      const key = `tenants/${ctx.tenantId}/subjectivities/${input.id}/${newId()}-${safeName(input.name)}`;

      await deps.storage.put({ key, body: input.body, contentType: input.contentType });

      return deps.uow.run(ctx, async (tx) => {
        const s = await loadSubjectivity(deps, tx, ctx, input.id);

        s.receive(
          {
            key,
            name: input.name,
            contentType: input.contentType,
            sizeBytes: input.body.byteLength,
            uploadedBy: personOf(ctx, input.actorName),
          },
          clockOf(deps, ctx),
        );

        await persist(deps, tx, s);

        return toSubjectivityDto(s, today(ctx));
      });
    },

    async document(ctx: TenantContext, input: { id: string; key: string }) {
      const s = await deps.uow.run(ctx, (tx) => loadSubjectivity(deps, tx, ctx, input.id));
      const doc = s.toSnapshot().documents.find((d) => d.key === input.key);
      const file = doc && (await deps.storage.get(doc.key));

      if (!doc || !file) throw notFound("Document", input.key);

      return { fileName: doc.name, contentType: doc.contentType, body: file.body };
    },

    async accept(ctx: TenantContext, input: { id: string; note?: string; actorName: string }) {
      const by = personOf(ctx, input.actorName);

      await deps.uow.run(ctx, async (tx) => {
        const s = await loadSubjectivity(deps, tx, ctx, input.id);

        s.accept(by, input.note?.trim() || null, clockOf(deps, ctx));
        await cleared(tx, ctx, s, by, "accepted");
      });
    },

    async waive(ctx: TenantContext, input: { id: string; reason: string; actorName: string }) {
      if (!input.reason.trim()) throw invalid("Say why it's waived", { field: "reason" });

      const by = personOf(ctx, input.actorName);

      await deps.uow.run(ctx, async (tx) => {
        const s = await loadSubjectivity(deps, tx, ctx, input.id);

        s.waive(by, input.reason.trim(), clockOf(deps, ctx));
        await cleared(tx, ctx, s, by, "waived");
      });
    },

    async reopen(ctx: TenantContext, input: { id: string; note: string; actorName: string }) {
      if (!input.note.trim()) throw invalid("Say what's still needed", { field: "note" });

      await deps.uow.run(ctx, async (tx) => {
        const s = await loadSubjectivity(deps, tx, ctx, input.id);

        s.reopen(personOf(ctx, input.actorName), input.note.trim(), clockOf(deps, ctx));
        await persist(deps, tx, s);
      });
    },
  };
}

export type ManageSubjectivities = ReturnType<typeof makeManageSubjectivities>;
