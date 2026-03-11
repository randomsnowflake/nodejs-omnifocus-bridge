import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveOmniFocusSource } from "../src/source/resolveOmniFocusSource.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-source-"));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

describe("resolveOmniFocusSource", () => {
  const previousLocal = process.env.OMNIFOCUS_LOCAL_PATH;
  const previousVault = process.env.OMNIFOCUS_VAULT_PATH;

  afterEach(() => {
    process.env.OMNIFOCUS_LOCAL_PATH = previousLocal;
    process.env.OMNIFOCUS_VAULT_PATH = previousVault;
  });

  it("resolves explicit local and vault sources", async () => {
    await withTempDir(async (tempDir) => {
      const localPath = path.join(tempDir, "local.ofocus");
      const vaultPath = path.join(tempDir, "vault.ofocus");
      await fs.promises.mkdir(localPath);
      await fs.promises.mkdir(vaultPath);
      await fs.promises.writeFile(path.join(vaultPath, "encrypted"), "metadata");

      expect(await resolveOmniFocusSource({ source: "local", path: localPath })).toEqual({
        source: "local",
        path: localPath
      });
      expect(await resolveOmniFocusSource({ source: "vault", path: vaultPath })).toEqual({
        source: "vault",
        path: vaultPath
      });
    });
  });

  it("auto-detects explicit paths and environment fallbacks", async () => {
    await withTempDir(async (tempDir) => {
      const localPath = path.join(tempDir, "local.ofocus");
      const vaultPath = path.join(tempDir, "vault.ofocus");
      await fs.promises.mkdir(localPath);
      await fs.promises.mkdir(vaultPath);
      await fs.promises.writeFile(path.join(vaultPath, "encrypted"), "metadata");

      expect(await resolveOmniFocusSource({ path: vaultPath })).toEqual({ source: "vault", path: vaultPath });

      process.env.OMNIFOCUS_LOCAL_PATH = localPath;
      process.env.OMNIFOCUS_VAULT_PATH = vaultPath;
      expect(await resolveOmniFocusSource()).toEqual({ source: "local", path: localPath });
    });
  });

  it("throws for missing paths", async () => {
    process.env.OMNIFOCUS_LOCAL_PATH = "";
    process.env.OMNIFOCUS_VAULT_PATH = "";
    await expect(resolveOmniFocusSource({ path: "/definitely/missing" })).rejects.toThrow("does not exist");
    await expect(resolveOmniFocusSource({ source: "vault" })).rejects.toThrow("vault path");
  });
});
