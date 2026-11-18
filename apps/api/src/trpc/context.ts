import type { Session } from "@pas/auth";
import type { FastifyRequest } from "fastify";
import type { Container } from "../composition";
import { toFetchHeaders } from "../http";

export interface Context {
  container: Container;
  headers: Headers;
  session: Session | null;
  client: { ipAddress: string; userAgent: string };
}

export async function createContext(container: Container, req: FastifyRequest): Promise<Context> {
  const headers = toFetchHeaders(req);
  const session = await container.auth.api.getSession({ headers });

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const client = {
    ipAddress: forwarded || req.ip,
    userAgent: headers.get("user-agent") ?? "unknown",
  };

  return { container, headers, session, client };
}
