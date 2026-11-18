import type { PrismaClient } from "@pas/db";
import type { ProducerDirectory } from "../ports/portal-services";

/** Producers are Better Auth users (Identity is the store); only name and email leave here. */
export class PrismaProducerDirectory implements ProducerDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async contacts(producerIds: readonly string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...producerIds] } },
      select: { id: true, name: true, email: true },
    });

    return new Map(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  }
}
