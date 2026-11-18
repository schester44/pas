import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  ADMIN_ORIGIN: z.string().url(),
  APP_ORIGIN: z.string().url(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
