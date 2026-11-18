import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ObjectStorage } from "./storage";

/** Disk-backed storage for local development. An S3 adapter implements the same port. */
export function createLocalStorage(rootDir: string): ObjectStorage {
  const root = resolve(rootDir);
  const pathFor = (key: string) => {
    const path = resolve(join(root, key));
    if (!path.startsWith(root)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  };

  return {
    async put({ key, body, contentType }) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }));
      return { key };
    },
    async get(key) {
      const path = pathFor(key);
      try {
        const [body, meta] = await Promise.all([
          readFile(path),
          readFile(`${path}.meta.json`, "utf8"),
        ]);
        return { body, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      const path = pathFor(key);
      await rm(path, { force: true });
      await rm(`${path}.meta.json`, { force: true });
    },
  };
}
