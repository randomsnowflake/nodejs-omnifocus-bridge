import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import JSZip from "jszip";
import plist from "plist";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readOmniFocus } from "../src/api.js";
import { DecryptionSession, DocumentKey, FileVerificationError, InvalidPasswordError, OmniFocusDecryptor } from "../src/crypto/OmniFocusDecryptor.js";
import { OmniFocusReader } from "../src/reader/OmniFocusReader.js";

const KEY_ID = 0x0001;
const ACTIVE_AES_CTR_HMAC = 3;
const PLAINTEXT_MASK = 5;
const KEY_MATERIAL = Buffer.from(
  "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100",
  "hex"
);

function buildSlot(slotType: number, id: number, contents: Buffer): Buffer {
  let normalized = contents;
  if (normalized.length % 4 !== 0) {
    const padded = Buffer.alloc(Math.ceil(normalized.length / 4) * 4);
    normalized.copy(padded);
    normalized = padded;
  }
  const slotLength = normalized.length / 4;
  return Buffer.concat([Buffer.from([slotType, slotLength, (id >> 8) & 0xff, id & 0xff]), normalized]);
}

function buildSecretsBuffer(slots: Array<{ type: number; id: number; contents: Buffer }>): Buffer {
  let buffer = Buffer.concat([...slots.map((slot) => buildSlot(slot.type, slot.id, slot.contents)), Buffer.from([0])]);
  if (buffer.length % 8 !== 0) {
    buffer = Buffer.concat([buffer, Buffer.alloc(8 - (buffer.length % 8), 0)]);
  }
  return buffer;
}

function aesKeyWrap(data: Buffer, kek: Buffer): Buffer {
  const cipher = crypto.createCipheriv("id-aes128-wrap", kek, Buffer.from("A6A6A6A6A6A6A6A6", "hex"));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function createEncryptedFileBuffer(plaintext: Buffer, keyMaterial: Buffer, keyId: number): Buffer {
  const magic = Buffer.from("OmniFileEncryption\u0000\u0000", "utf-8");
  const info = Buffer.alloc(2);
  info.writeUInt16BE(keyId, 0);
  const infoLength = Buffer.alloc(2);
  infoLength.writeUInt16BE(info.length, 0);
  const header = Buffer.concat([magic, infoLength, info]);
  const padding = Buffer.alloc((16 - (header.length % 16)) % 16, 0);
  const aesKey = keyMaterial.subarray(0, 16);
  const hmacKey = keyMaterial.subarray(16, 32);
  const segmentIv = Buffer.from("000102030405060708090a0b", "hex");
  const indexBuffer = Buffer.alloc(4);
  indexBuffer.writeUInt32BE(0, 0);

  const cipher = crypto.createCipheriv("aes-128-ctr", aesKey, Buffer.concat([segmentIv, Buffer.from([0, 0, 0, 0])]));
  const encryptedData = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const segmentHash = crypto.createHmac("sha256", hmacKey);
  segmentHash.update(segmentIv);
  segmentHash.update(indexBuffer);
  segmentHash.update(encryptedData);
  const segmentMac = segmentHash.digest().subarray(0, 20);

  const fileHash = crypto.createHmac("sha256", hmacKey);
  fileHash.update(Buffer.from([0x01]));
  fileHash.update(segmentMac);

  return Buffer.concat([header, padding, segmentIv, segmentMac, encryptedData, fileHash.digest()]);
}

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-crypto-"));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function createZipWithContents(xml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("contents.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function createOuterArchive(zipFiles: Record<string, string>): Promise<Buffer> {
  const archive = new JSZip();
  archive.folder("Test.ofocus");
  for (const [name, xml] of Object.entries(zipFiles)) {
    archive.file(`Test.ofocus/${name}`, await createZipWithContents(xml));
  }
  return archive.generateAsync({ type: "nodebuffer" });
}

async function createEncryptedVault(dir: string, password: string, xml: string): Promise<string> {
  const vaultPath = path.join(dir, "vault.ofocus");
  await fs.promises.mkdir(vaultPath, { recursive: true });

  const secrets = buildSecretsBuffer([{ type: ACTIVE_AES_CTR_HMAC, id: KEY_ID, contents: KEY_MATERIAL }]);
  const salt = Buffer.from("salt");
  const metadataKey = crypto.pbkdf2Sync(password, salt, 1, 16, "sha1");
  const metadata = {
    method: "password",
    algorithm: "PBKDF2; aes128-wrap",
    rounds: 1,
    salt: { string: salt.toString("base64") },
    key: { string: aesKeyWrap(secrets, metadataKey).toString("base64") }
  };

  await fs.promises.writeFile(path.join(vaultPath, "encrypted"), plist.build(metadata));
  await fs.promises.writeFile(
    path.join(vaultPath, "00000000000000=base+root.zip"),
    createEncryptedFileBuffer(await createZipWithContents(xml), KEY_MATERIAL, KEY_ID)
  );

  return vaultPath;
}

describe("DocumentKey and decryptor helpers", () => {
  const originalPassword = process.env.OMNIFOCUS_PASSWORD;

  afterEach(() => {
    process.env.OMNIFOCUS_PASSWORD = originalPassword;
  });

  it("parses metadata, derives passwords, decrypts files, and allows plaintext masks", async () => {
    const metadata = {
      method: "password",
      algorithm: "PBKDF2; aes128-wrap",
      rounds: 1,
      salt: { string: Buffer.from("salt").toString("base64") },
      key: { string: Buffer.from("keydata").toString("base64") }
    };
    expect(DocumentKey.parseMetadata(Buffer.from(plist.build([metadata])))).toEqual(metadata);
    expect(() => DocumentKey.parseMetadata(Buffer.from(plist.build("bad")))).toThrow("Expected metadata");

    const derived = DocumentKey.usePassphrase(
      {
        method: "password",
        algorithm: "PBKDF2; aes128-wrap",
        rounds: 1,
        salt: Buffer.from("salt")
      } as never,
      "password"
    );
    expect(derived.equals(crypto.pbkdf2Sync("password", "salt", 1, 16, "sha1"))).toBe(true);
    expect(() =>
      DocumentKey.usePassphrase(
        { method: "token", algorithm: "PBKDF2; aes128-wrap", rounds: 1, salt: Buffer.from("salt") } as never,
        "password"
      )
    ).toThrow(InvalidPasswordError);

    const docKey = new DocumentKey(buildSecretsBuffer([{ type: ACTIVE_AES_CTR_HMAC, id: KEY_ID, contents: KEY_MATERIAL }]));
    expect(() => docKey.getDecryptor(Buffer.from([0, 9]))).toThrow("matching entry");

    await withTempDir(async (tempDir) => {
      const inputPath = path.join(tempDir, "data.ofocus");
      const outputPath = path.join(tempDir, "data.xml");
      const plaintext = Buffer.from("Hello OmniFocus");
      await fs.promises.writeFile(inputPath, createEncryptedFileBuffer(plaintext, KEY_MATERIAL, KEY_ID));
      await docKey.decryptFile("data.ofocus", inputPath, outputPath);
      expect((await fs.promises.readFile(outputPath)).equals(plaintext)).toBe(true);

      const maskedDocKey = new DocumentKey(
        buildSecretsBuffer([
          { type: ACTIVE_AES_CTR_HMAC, id: KEY_ID, contents: KEY_MATERIAL },
          { type: PLAINTEXT_MASK, id: 2, contents: Buffer.from(".txt") }
        ])
      );
      const textPath = path.join(tempDir, "notes.txt");
      await fs.promises.writeFile(textPath, "plain text");
      await maskedDocKey.decryptFile("notes.txt", textPath, textPath);
      expect(await fs.promises.readFile(textPath, "utf8")).toBe("plain text");

      const tampered = createEncryptedFileBuffer(Buffer.from("tampered"), KEY_MATERIAL, KEY_ID);
      tampered[tampered.length - 1] ^= 0xff;
      await fs.promises.writeFile(inputPath, tampered);
      await expect(docKey.decryptFile("data.ofocus", inputPath, outputPath)).rejects.toThrow(FileVerificationError);
    });
  });

  it("decrypts full vault sessions and supports env password fallback", async () => {
    await withTempDir(async (tempDir) => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><omnifocus><task id="task-1"><name>Hello</name></task></omnifocus>`;
      const vaultPath = await createEncryptedVault(tempDir, "secret", xml);

      process.env.OMNIFOCUS_PASSWORD = "secret";
      expect(() => new DecryptionSession(vaultPath)).not.toThrow();
      expect(() => new DecryptionSession(vaultPath, "")).toThrow(InvalidPasswordError);
      const session = new DecryptionSession(vaultPath, "secret");
      const decryptedPath = await session.decrypt();
      expect(await fs.promises.stat(decryptedPath)).toBeTruthy();
      await session.cleanup();

      await expect(
        OmniFocusDecryptor.withDecryptedDatabase(vaultPath, async (decryptedDir) => {
          const contents = await fs.promises.readdir(decryptedDir);
          expect(contents.some((entry) => entry.endsWith(".zip"))).toBe(true);
          return "done";
        }, "secret")
      ).resolves.toBe("done");

      expect(await OmniFocusDecryptor.isEncryptedDatabase(vaultPath)).toBe(true);
      expect(await OmniFocusDecryptor.isEncryptedDatabase(path.join(tempDir, "missing"))).toBe(false);
    });
  });

  it("fails instead of silently skipping transient decrypt errors", async () => {
    await withTempDir(async (tempDir) => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><omnifocus><task id="task-1"><name>Hello</name></task></omnifocus>`;
      const vaultPath = await createEncryptedVault(tempDir, "secret", xml);
      const session = new DecryptionSession(vaultPath, "secret");

      const decryptSpy = vi
        .spyOn(DocumentKey.prototype, "decryptFile")
        .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));

      await expect(session.decrypt()).rejects.toMatchObject({ code: "EBUSY" });

      decryptSpy.mockRestore();
      await session.cleanup();
    });
  });
});

describe("OmniFocusReader and public API", () => {
  it("reads xml from directories, direct xml, archives, encrypted vaults, and the public API", async () => {
    await withTempDir(async (tempDir) => {
      const baseXml = `<?xml version="1.0" encoding="UTF-8"?><omnifocus><folder id="folder-1"><name>Folder</name></folder></omnifocus>`;
      const patchXml = `<?xml version="1.0" encoding="UTF-8"?><omnifocus><task id="task-1"><name>Task</name></task></omnifocus>`;
      const localPath = path.join(tempDir, "local.ofocus");
      await fs.promises.mkdir(localPath);
      await fs.promises.writeFile(path.join(localPath, "00000000000000=base+root.zip"), await createZipWithContents(baseXml));
      await fs.promises.writeFile(path.join(localPath, "20240101000000=root+leaf.zip"), await createZipWithContents(patchXml));

      const reader = new OmniFocusReader();
      const allXml = await reader.readAllXml(localPath);
      expect(allXml).toHaveLength(2);
      expect(await reader.readBaseXml(localPath)).toContain("<folder");

      const xmlPath = path.join(tempDir, "contents.xml");
      await fs.promises.writeFile(xmlPath, baseXml);
      expect(await reader.readBaseXml(xmlPath)).toContain("<folder");
      expect(await reader.readAllXml(xmlPath)).toEqual([baseXml]);

      const archivePath = path.join(tempDir, "archive.zip");
      await fs.promises.writeFile(
        archivePath,
        await createOuterArchive({
          "00000000000000=base+root.zip": baseXml,
          "20240101000000=root+leaf.zip": patchXml
        })
      );
      expect((await reader.readAllXml(archivePath)).length).toBe(2);

      const dataDir = path.join(tempDir, "data-xml.ofocus");
      await fs.promises.mkdir(path.join(dataDir, "data"), { recursive: true });
      await fs.promises.writeFile(path.join(dataDir, "data", "contents.xml"), baseXml);
      expect(await reader.readBaseXml(dataDir)).toContain("<folder");

      const encryptedPath = await createEncryptedVault(tempDir, "secret", baseXml);
      expect(await reader.readBaseXml(encryptedPath, "secret")).toContain("<folder");

      const document = await readOmniFocus(localPath, { source: "local", readAllPatches: true });
      expect(document.folders).toHaveLength(1);
      expect(document.tasks).toHaveLength(1);

      const baseOnly = await readOmniFocus({ source: "local", path: localPath, readAllPatches: false });
      expect(baseOnly.tasks).toHaveLength(0);
    });
  });

  it("throws useful errors for invalid paths and missing passwords", async () => {
    const reader = new OmniFocusReader();
    await expect(reader.readBaseXml("/definitely/missing")).rejects.toThrow();

    await withTempDir(async (tempDir) => {
      const emptyPath = path.join(tempDir, "empty.ofocus");
      await fs.promises.mkdir(emptyPath);
      await expect(reader.readAllXml(emptyPath)).rejects.toThrow("Unable to locate OmniFocus database");

      const vaultPath = path.join(tempDir, "vault.ofocus");
      await fs.promises.mkdir(vaultPath);
      await fs.promises.writeFile(path.join(vaultPath, "encrypted"), "metadata");
      await expect(readOmniFocus({ source: "vault", path: vaultPath })).rejects.toThrow();
    });
  });
});
