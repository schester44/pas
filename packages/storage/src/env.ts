import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createLocalStorage } from "./local";
import { createS3Storage } from "./s3";
import type { ObjectStorage } from "./storage";

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];

  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);

  return value;
}

// Relative paths resolve from the workspace root so the api and worker share one directory.
function localDir(dir: string): string {
  if (isAbsolute(dir)) return dir;

  let at = process.cwd();

  while (!existsSync(join(at, "pnpm-workspace.yaml")) && dirname(at) !== at) at = dirname(at);

  return resolve(existsSync(join(at, "pnpm-workspace.yaml")) ? at : process.cwd(), dir);
}

/**
 * Build storage from env. `STORAGE_DRIVER=local` (default) uses `STORAGE_LOCAL_DIR`;
 * `STORAGE_DRIVER=s3` uses `S3_BUCKET`, `S3_REGION`, and optionally `S3_ENDPOINT`,
 * `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
 */
export function createStorageFromEnv(env: Env = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? "local";

  switch (driver) {
    case "local":
      return createLocalStorage(localDir(env.STORAGE_LOCAL_DIR ?? ".storage"));
    case "s3": {
      const accessKeyId = env.S3_ACCESS_KEY_ID;
      const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

      if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
        throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither");
      }

      return createS3Storage({
        bucket: required(env, "S3_BUCKET"),
        region: required(env, "S3_REGION"),
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
        forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
        ...(accessKeyId && secretAccessKey
          ? { credentials: { accessKeyId, secretAccessKey } }
          : {}),
      });
    }
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${driver} (expected "local" or "s3")`);
  }
}
