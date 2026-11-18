import { compose } from "./composition";
import { env } from "./env";
import { buildServer } from "./server";

const container = compose();
const server = await buildServer(container);

const shutdown = async () => {
  await server.close();
  await container.queues.stop();
  await container.workflows.close();
  await container.prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.listen({ port: env.API_PORT, host: "0.0.0.0" });
