// Test doubles for the clip tasks: an in-memory ObjectStore.
import { createHash } from "node:crypto";
import type { Bucket, ObjectStore, PutResult } from "../src/tasks/clip-media.ts";

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  readonly puts: string[] = [];

  static id(bucket: Bucket, key: string): string {
    return `${bucket}:${key}`;
  }

  async put(
    bucket: Bucket,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<PutResult> {
    const id = MemoryObjectStore.id(bucket, key);
    this.objects.set(id, { body: new Uint8Array(body), contentType });
    this.puts.push(id);
    return { bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array | null> {
    return this.objects.get(MemoryObjectStore.id(bucket, key))?.body ?? null;
  }

  has(bucket: Bucket, key: string): boolean {
    return this.objects.has(MemoryObjectStore.id(bucket, key));
  }

  text(bucket: Bucket, key: string): string | null {
    const o = this.objects.get(MemoryObjectStore.id(bucket, key));
    return o ? new TextDecoder().decode(o.body) : null;
  }
}
