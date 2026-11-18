import type { Session } from "@pas/auth";
import type { FastifyRequest } from "fastify";
import type { Container } from "../composition";
import { toFetchHeaders } from "../http";

export interface Context {
  container: Container;
  headers: Headers;
  session: Session | null;
}

export async function createContext(container: Container, req: FastifyRequest): Promise<Context> {
  const headers = toFetchHeaders(req);
  const session = await container.auth.api.getSession({ headers });

  return { container, headers, session };
}
