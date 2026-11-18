import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { ObjectStorage } from "./storage";

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Custom endpoint for S3-compatible stores (MinIO, R2, …). */
  endpoint?: string;
  /** Use `endpoint/bucket/key` URLs instead of `bucket.endpoint/key`. MinIO usually needs this. */
  forcePathStyle?: boolean;
  /** Static credentials. Omit to use the default AWS provider chain (env, profile, IAM role). */
  credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
}

/** S3 (or S3-compatible) object storage. */
export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const { bucket } = options;

  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });

  return {
    async put({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );

      return { key };
    },
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

        if (!result.Body) return null;

        return {
          body: await result.Body.transformToByteArray(),
          contentType: result.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;

        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
          return null;
        }

        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
