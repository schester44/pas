import { z } from "zod";

export const env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
  })
  .parse(process.env);
