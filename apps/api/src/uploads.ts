import multipart from "@fastify/multipart";
import type { Permission } from "@pas/auth";
import { MAX_FORM_EDITION_BYTES } from "@pas/form-library";
import { asId, DomainError, type DomainErrorCode, type TenantContext } from "@pas/kernel";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Container } from "./composition";
import { toFetchHeaders } from "./http";

const STATUS: Record<DomainErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  forbidden: 403,
  precondition_failed: 412,
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function tenantFor(
  container: Container,
  req: FastifyRequest,
  permissions: Permission,
): Promise<TenantContext> {
  const headers = toFetchHeaders(req);
  const session = await container.auth.api.getSession({ headers });

  if (!session) throw new HttpError(401, "Sign in to continue");

  const tenantId = session.session.activeOrganizationId;

  if (!tenantId) throw new HttpError(412, "No active organization");

  const allowed = await container.auth.api.hasPermission({ headers, body: { permissions } });

  if (!allowed.success) throw new HttpError(403, "You don't have access to the forms library");

  return { tenantId: asId(tenantId), actor: { type: "user", userId: asId(session.user.id) } };
}

function fail(reply: FastifyReply, error: unknown, container: Container) {
  if (error instanceof HttpError)
    return reply.status(error.status).send({ message: error.message });

  if (error instanceof DomainError) {
    return reply
      .status(STATUS[error.code])
      .send({ message: error.message, details: error.details ?? null });
  }

  if ((error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
    return reply.status(413).send({ message: "Upload a PDF smaller than 20 MB" });
  }

  container.logger.error({ err: error }, "upload route failed");

  return reply.status(500).send({ message: "Something went wrong" });
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Binary uploads and downloads live outside tRPC; everything else about them is a use case. */
export const uploadRoutes =
  (container: Container): FastifyPluginAsync =>
  async (server) => {
    await server.register(multipart, {
      limits: { fileSize: MAX_FORM_EDITION_BYTES, files: 1, fields: 10, fieldSize: 10_000 },
    });

    server.post("/api/uploads/form-editions", async (req, reply) => {
      try {
        const tenant = await tenantFor(container, req, { document: ["write"] });
        const fields: Record<string, string> = {};
        let file: Uint8Array | undefined;

        for await (const part of req.parts()) {
          if (part.type === "file") file = new Uint8Array(await part.toBuffer());
          else fields[part.fieldname] = String(part.value ?? "");
        }

        if (!file) throw new HttpError(400, "Choose a PDF to upload");

        const edition = await container.useCases.formLibrary.upload(tenant, {
          formNumber: fields.formNumber ?? "",
          edition: fields.edition ?? "",
          title: fields.title ?? "",
          jurisdictions: list(fields.jurisdictions),
          carrier: fields.carrier?.trim() || null,
          file,
        });

        return reply.status(201).send(edition);
      } catch (error) {
        return fail(reply, error, container);
      }
    });

    server.get<{ Params: { id: string } }>("/api/uploads/form-editions/:id", async (req, reply) => {
      try {
        const tenant = await tenantFor(container, req, { document: ["read"] });

        if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
          throw new HttpError(404, "Form edition not found");

        const { edition, body } = await container.useCases.formLibrary.getFile(tenant, {
          id: req.params.id,
        });

        const name = `${edition.formNumber} ${edition.editionLabel}.pdf`.replace(/[^\w .-]/g, "");

        return reply
          .header("content-type", "application/pdf")
          .header("content-length", body.byteLength)
          .header("content-disposition", `inline; filename="${name}"`)
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
      } catch (error) {
        return fail(reply, error, container);
      }
    });
  };
