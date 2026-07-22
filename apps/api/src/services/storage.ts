import fs from "node:fs/promises";
import path from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export type StorageMode = "local" | "r2";

function getR2Client() {
  if (!config.r2.accountId || !config.r2.accessKeyId || !config.r2.secretAccessKey) {
    throw new Error("R2 credentials are not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
}

async function ensureLocalDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export const storage = {
  mode(): StorageMode {
    return config.storageDriver;
  },

  localPath(key: string) {
    return path.join(config.localStorageDir, key);
  },

  async putLocal(key: string, data: Buffer, _mimeType: string) {
    const fullPath = this.localPath(key);
    await ensureLocalDir(fullPath);
    await fs.writeFile(fullPath, data);
  },

  async createUploadTarget(input: {
    key: string;
    mimeType: string;
    documentId: string;
  }): Promise<{
    mode: StorageMode;
    url: string;
    headers?: Record<string, string>;
  }> {
    if (config.storageDriver === "local") {
      return {
        mode: "local",
        url: `/api/uploads/${input.documentId}/content`,
      };
    }

    const client = getR2Client();
    const command = new PutObjectCommand({
      Bucket: config.r2.bucket,
      Key: input.key,
      ContentType: input.mimeType,
    });
    const url = await getSignedUrl(client, command, { expiresIn: 60 * 15 });
    return {
      mode: "r2",
      url,
      headers: {
        "Content-Type": input.mimeType,
      },
    };
  },

  async downloadToFile(key: string, destPath: string): Promise<void> {
    await ensureLocalDir(destPath);

    if (config.storageDriver === "local") {
      await fs.copyFile(this.localPath(key), destPath);
      return;
    }

    const client = getR2Client();
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.r2.bucket,
        Key: key,
      }),
    );

    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty object for key ${key}`);
    }
    await fs.writeFile(destPath, Buffer.from(bytes));
  },

  async readBuffer(key: string): Promise<Buffer> {
    if (config.storageDriver === "local") {
      return fs.readFile(this.localPath(key));
    }

    const client = getR2Client();
    const result = await client.send(
      new GetObjectCommand({
        Bucket: config.r2.bucket,
        Key: key,
      }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty object for key ${key}`);
    }
    return Buffer.from(bytes);
  },

  async deleteObject(key: string): Promise<void> {
    if (config.storageDriver === "local") {
      try {
        await fs.unlink(this.localPath(key));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
      return;
    }

    const client = getR2Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.r2.bucket,
        Key: key,
      }),
    );
  },
};
