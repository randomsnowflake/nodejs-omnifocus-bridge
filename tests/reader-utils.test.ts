import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { directoryExists, fileExists, isTransientFileError, statIfExists, withRetry } from "../src/reader/fileUtils.js";
import { orderOmniFocusFiles, parsePatchDescriptor } from "../src/reader/patchOrdering.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-utils-"));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

describe("fileUtils", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("detects transient file errors", () => {
    expect(isTransientFileError({ code: "EACCES" })).toBe(true);
    expect(isTransientFileError({ code: "ENOENT" })).toBe(true);
    expect(isTransientFileError({ code: "EBUSY" })).toBe(true);
    expect(isTransientFileError({ code: "EINVAL" })).toBe(false);
    expect(isTransientFileError(null)).toBe(false);
  });

  it("retries transient failures and reports file presence helpers", async () => {
    let attempts = 0;
    await expect(withRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("busy") as Error & { code: string };
        error.code = "EBUSY";
        throw error;
      }
      return "ok";
    }, 3, 0)).resolves.toBe("ok");

    await withTempDir(async (tempDir) => {
      const filePath = path.join(tempDir, "file.txt");
      await fs.promises.writeFile(filePath, "hello");
      expect(await statIfExists(filePath)).not.toBeNull();
      expect(await statIfExists(path.join(tempDir, "missing"))).toBeNull();
      expect(await directoryExists(tempDir)).toBe(true);
      expect(await fileExists(filePath)).toBe(true);
      expect(await fileExists(tempDir)).toBe(false);
    });
  });

  it("stops retrying non-transient errors", async () => {
    const error = new Error("bad") as Error & { code: string };
    error.code = "EINVAL";
    await expect(withRetry(async () => Promise.reject(error), 1, 1)).rejects.toBe(error);
  });
});

describe("patchOrdering", () => {
  it("parses descriptors and orders base plus dependent patches", () => {
    const base = "/tmp/00000000000000=base+root.zip";
    const patch1 = "/tmp/20240101000000=root+mid.zip";
    const patch2 = "/tmp/20240102000000=mid+leaf.zip";
    const unrelated = "/tmp/plain.zip";

    expect(parsePatchDescriptor(base)?.isBase).toBe(true);
    expect(parsePatchDescriptor(unrelated)).toBeNull();
    expect(orderOmniFocusFiles([patch2, unrelated, base, patch1])).toEqual([base, patch1, patch2, unrelated]);
  });

  it("falls back when no base descriptor is present", () => {
    const files = ["/tmp/20240102000000=a+b.zip", "/tmp/20240101000000=b+c.zip"];
    expect(orderOmniFocusFiles(files)).toEqual(files);
  });
});
