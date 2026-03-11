import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import plistModule from "plist";

import {
  DecryptionError,
  FileVerificationError,
  InvalidFileFormatError,
  InvalidPasswordError
} from "../errors.js";
import { readFile, readdir, stat, isTransientFileError } from "./cryptoUtils.js";

const plist = (plistModule as typeof plistModule & { default?: typeof plistModule }).default ?? plistModule;

interface Slot {
  type: number;
  id: number;
  contents: Buffer;
}

interface EncryptionMetadata {
  method: string;
  algorithm: string;
  rounds: number;
  salt: Buffer | { string: string };
  prf?: string;
  key: Buffer | { string: string };
}

export { DecryptionError, FileVerificationError, InvalidFileFormatError, InvalidPasswordError };

export class DocumentKey {
  private static readonly SLOT_TYPES = {
    ActiveAESWRAP: 1,
    RetiredAESWRAP: 2,
    ActiveAES_CTR_HMAC: 3,
    RetiredAES_CTR_HMAC: 4,
    PlaintextMask: 5,
    RetiredPlaintextMask: 6
  };

  private static readonly FILE_MAGIC = Buffer.from("OmniFileEncryption\u0000\u0000");
  static readonly METADATA_FILENAME = "encrypted";

  private secrets: Slot[] = [];

  constructor(secrets: Buffer | null = null, unwrappingKey: Buffer | null = null) {
    if (!secrets) {
      return;
    }

    const unwrapped = unwrappingKey ? this.aesKeyUnwrap(secrets, unwrappingKey) : secrets;
    this.parseSecrets(unwrapped);
  }

  static parseMetadata(metadataBlob: Buffer | string): EncryptionMetadata {
    const metadata = plist.parse(metadataBlob.toString()) as unknown;
    if (Array.isArray(metadata) && metadata.length === 1) {
      return metadata[0] as EncryptionMetadata;
    }

    if (typeof metadata !== "object" || metadata === null) {
      throw new Error("Expected metadata to be an object");
    }

    return metadata as EncryptionMetadata;
  }

  static usePassphrase(metadata: EncryptionMetadata, passphrase: string): Buffer {
    if (metadata.method !== "password") {
      throw new InvalidPasswordError(`Unsupported method: ${metadata.method}`);
    }
    if (metadata.algorithm !== "PBKDF2; aes128-wrap") {
      throw new InvalidPasswordError(`Unsupported algorithm: ${metadata.algorithm}`);
    }

    const salt =
      typeof metadata.salt === "object" && "string" in metadata.salt
        ? Buffer.from(metadata.salt.string, "base64")
        : (metadata.salt as Buffer);
    const digest = metadata.prf === "sha256" ? "sha256" : metadata.prf === "sha512" ? "sha512" : "sha1";

    return crypto.pbkdf2Sync(Buffer.from(passphrase, "utf-8"), salt, metadata.rounds, 16, digest);
  }

  getDecryptor(info: Buffer): EncryptedFileHelper {
    const keyId = info.readUInt16BE(0);
    const slots = this.secrets.filter((slot) => slot.id === keyId);
    if (slots.length !== 1) {
      throw new DecryptionError(`Should have exactly one matching entry for key ${keyId}, found ${slots.length}`);
    }

    const slot = slots[0];
    if (
      slot.type === DocumentKey.SLOT_TYPES.ActiveAES_CTR_HMAC ||
      slot.type === DocumentKey.SLOT_TYPES.RetiredAES_CTR_HMAC
    ) {
      if (info.length !== 2) {
        throw new DecryptionError(`No per-file info expected for key type ${slot.type}`);
      }
      return new EncryptedFileHelper(slot.contents);
    }

    if (
      slot.type === DocumentKey.SLOT_TYPES.ActiveAESWRAP ||
      slot.type === DocumentKey.SLOT_TYPES.RetiredAESWRAP
    ) {
      const wrappedKey = info.subarray(2);
      if (wrappedKey.length % 8 !== 0) {
        throw new DecryptionError(`AESWRAPped info length error: ${wrappedKey.length} bytes`);
      }
      return new EncryptedFileHelper(this.aesKeyUnwrap(wrappedKey, slot.contents));
    }

    throw new DecryptionError(`Unknown keyslot type: ${slot.type}`);
  }

  applicablePolicySlots(filename: string): Slot[] {
    const filenameBytes = Buffer.from(filename, "utf-8");
    return this.secrets.filter((slot) => {
      if (
        slot.type === DocumentKey.SLOT_TYPES.PlaintextMask ||
        slot.type === DocumentKey.SLOT_TYPES.RetiredPlaintextMask
      ) {
        return filenameBytes.indexOf(this.trimZeroPadding(slot.contents)) !== -1;
      }
      return false;
    });
  }

  async decryptFile(filename: string, inputPath: string, outputPath: string): Promise<void> {
    const canReadPlaintext = this.applicablePolicySlots(filename).some(
      (slot) => slot.type === DocumentKey.SLOT_TYPES.PlaintextMask
    );

    const inputBuffer = await readFile(inputPath);
    let position = 0;
    const magic = inputBuffer.subarray(position, position + DocumentKey.FILE_MAGIC.length);
    position += DocumentKey.FILE_MAGIC.length;

    if (!magic.equals(DocumentKey.FILE_MAGIC)) {
      if (canReadPlaintext && !inputBuffer.includes(Buffer.from("crypt"))) {
        await fs.promises.writeFile(outputPath, inputBuffer);
        return;
      }
      throw new InvalidFileFormatError("Incorrect file magic, expected encrypted file");
    }

    const infoLength = inputBuffer.readUInt16BE(position);
    position += 2;
    const info = inputBuffer.subarray(position, position + infoLength);
    position += infoLength;
    position += (16 - (position % 16)) % 16;

    const decryptor = this.getDecryptor(info);
    const segmentsStart = position;
    const segmentsEnd = inputBuffer.length - decryptor.fileMacLen;
    const fileHmac = inputBuffer.subarray(segmentsEnd);

    decryptor.checkHmac(inputBuffer, segmentsStart, segmentsEnd, fileHmac);
    const decrypted = decryptor.decrypt(inputBuffer, segmentsStart, segmentsEnd);
    await fs.promises.writeFile(outputPath, decrypted);
  }

  private aesKeyUnwrap(wrapped: Buffer, kek: Buffer): Buffer {
    const decipher = crypto.createDecipheriv("id-aes128-wrap", kek, Buffer.from("A6A6A6A6A6A6A6A6", "hex"));
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }

  private parseSecrets(unwrapped: Buffer): void {
    const secrets: Slot[] = [];
    let index = 0;

    while (index < unwrapped.length) {
      const slotType = unwrapped[index] ?? 0;
      if (slotType === 0) {
        break;
      }

      const slotLength = 4 * (unwrapped[index + 1] ?? 0);
      secrets.push({
        type: slotType,
        id: unwrapped.readUInt16BE(index + 2),
        contents: unwrapped.subarray(index + 4, index + 4 + slotLength)
      });
      index += 4 + slotLength;
    }

    this.secrets = secrets;
  }

  private trimZeroPadding(bytes: Buffer): Buffer {
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) {
      end -= 1;
    }
    return bytes.subarray(0, end);
  }
}

class EncryptedFileHelper {
  private static readonly SEG_IV_LEN = 12;
  private static readonly SEG_MAC_LEN = 20;
  private static readonly SEG_PAGE_SIZE = 65536;
  private static readonly FILE_MAC_PREFIX = Buffer.from([0x01]);
  private static readonly FILE_MAC_LEN = 32;

  readonly fileMacLen = EncryptedFileHelper.FILE_MAC_LEN;

  private readonly aesKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor(keyMaterial: Buffer) {
    if (keyMaterial.length !== 32) {
      throw new DecryptionError(`Expected 32 bytes of key material, got ${keyMaterial.length}`);
    }
    this.aesKey = keyMaterial.subarray(0, 16);
    this.hmacKey = keyMaterial.subarray(16, 32);
  }

  checkHmac(buffer: Buffer, segmentsStart: number, segmentsEnd: number, fileHmac: Buffer): void {
    const fileHash = crypto.createHmac("sha256", this.hmacKey);
    fileHash.update(EncryptedFileHelper.FILE_MAC_PREFIX);

    for (const [segmentIndex, startPos, dataLen] of this.segmentRanges(segmentsStart, segmentsEnd)) {
      const segmentIv = buffer.subarray(startPos, startPos + EncryptedFileHelper.SEG_IV_LEN);
      const segmentMac = buffer.subarray(
        startPos + EncryptedFileHelper.SEG_IV_LEN,
        startPos + EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN
      );

      const segmentHash = crypto.createHmac("sha256", this.hmacKey);
      const indexBuffer = Buffer.allocUnsafe(4);
      indexBuffer.writeUInt32BE(segmentIndex, 0);
      segmentHash.update(segmentIv);
      segmentHash.update(indexBuffer);
      segmentHash.update(
        buffer.subarray(
          startPos + EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN,
          startPos + EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN + dataLen
        )
      );

      const computed = segmentHash.digest();
      if (!computed.subarray(0, EncryptedFileHelper.SEG_MAC_LEN).equals(segmentMac)) {
        throw new FileVerificationError(`Segment ${segmentIndex} MAC verification failed`);
      }

      fileHash.update(segmentMac);
    }

    if (!fileHash.digest().equals(fileHmac)) {
      throw new FileVerificationError("File MAC verification failed");
    }
  }

  decrypt(buffer: Buffer, segmentsStart: number, segmentsEnd: number): Buffer {
    const decryptedChunks: Buffer[] = [];

    for (const [, startPos, dataLen] of this.segmentRanges(segmentsStart, segmentsEnd)) {
      const segmentIv = buffer.subarray(startPos, startPos + EncryptedFileHelper.SEG_IV_LEN);
      const decipher = crypto.createDecipheriv(
        "aes-128-ctr",
        this.aesKey,
        Buffer.concat([segmentIv, Buffer.from([0, 0, 0, 0])])
      );

      const encryptedData = buffer.subarray(
        startPos + EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN,
        startPos + EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN + dataLen
      );

      decryptedChunks.push(decipher.update(encryptedData));
      decryptedChunks.push(decipher.final());
    }

    return Buffer.concat(decryptedChunks);
  }

  private segmentRanges(segmentsStart: number, segmentsEnd: number): Array<[number, number, number]> {
    const encryptedHeaderSize = EncryptedFileHelper.SEG_IV_LEN + EncryptedFileHelper.SEG_MAC_LEN;
    const ranges: Array<[number, number, number]> = [];
    let index = 0;
    let position = segmentsStart;

    while (true) {
      if (position + encryptedHeaderSize > segmentsEnd) {
        throw new DecryptionError("Segment position error");
      }

      if (position + encryptedHeaderSize + EncryptedFileHelper.SEG_PAGE_SIZE > segmentsEnd) {
        ranges.push([index, position, segmentsEnd - (position + encryptedHeaderSize)]);
        break;
      }

      ranges.push([index, position, EncryptedFileHelper.SEG_PAGE_SIZE]);
      position += encryptedHeaderSize + EncryptedFileHelper.SEG_PAGE_SIZE;
      index += 1;
    }

    return ranges;
  }
}

export class DecryptionSession {
  private tempDir: string | null = null;
  private decryptedPath: string | null = null;

  constructor(
    private readonly encryptedPath: string,
    private readonly password: string = process.env.OMNIFOCUS_PASSWORD || ""
  ) {
    if (!this.password) {
      throw new InvalidPasswordError("No password provided and OMNIFOCUS_PASSWORD environment variable not set");
    }
  }

  async decrypt(): Promise<string> {
    this.tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-decrypted-"));
    this.decryptedPath = this.tempDir;

    try {
      await this.decryptDirectory(this.encryptedPath, this.decryptedPath);
      return this.decryptedPath;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.tempDir) {
      return;
    }

    await fs.promises.rm(this.tempDir, { recursive: true, force: true });
    this.tempDir = null;
    this.decryptedPath = null;
  }

  private async decryptDirectory(indir: string, outdir: string): Promise<void> {
    const inputStats = await stat(indir);
    if (!inputStats.isDirectory()) {
      throw new InvalidFileFormatError(`Input path '${indir}' is not a directory`);
    }

    const files = await readdir(indir);
    if (!files.includes(DocumentKey.METADATA_FILENAME)) {
      throw new InvalidFileFormatError(`Expected to find '${DocumentKey.METADATA_FILENAME}' in '${indir}'`);
    }

    const metadataContent = await readFile(path.join(indir, DocumentKey.METADATA_FILENAME));
    const encryptionMetadata = DocumentKey.parseMetadata(metadataContent);
    const metadataKey = DocumentKey.usePassphrase(encryptionMetadata, this.password);
    const keyData =
      typeof encryptionMetadata.key === "object" && "string" in encryptionMetadata.key
        ? Buffer.from(encryptionMetadata.key.string, "base64")
        : (encryptionMetadata.key as Buffer);

    const documentKey = new DocumentKey(keyData, metadataKey);
    await fs.promises.mkdir(outdir, { recursive: true });
    await this.processDirectory(indir, outdir, documentKey, "");
  }

  private async processDirectory(indir: string, outdir: string, documentKey: DocumentKey, relativePath: string): Promise<void> {
    const entries = await readdir(path.join(indir, relativePath), { withFileTypes: true });
    for (const entry of entries) {
      const entryRelativePath = path.join(relativePath, entry.name);
      const inputPath = path.join(indir, entryRelativePath);
      const outputPath = path.join(outdir, entryRelativePath);

      if (entry.isDirectory()) {
        await fs.promises.mkdir(outputPath, { recursive: true });
        await this.processDirectory(indir, outdir, documentKey, entryRelativePath);
        continue;
      }

      if (!entry.isFile() || entry.name === DocumentKey.METADATA_FILENAME) {
        continue;
      }

      try {
        await documentKey.decryptFile(entry.name, inputPath, outputPath);
      } catch (error) {
        if (isTransientFileError(error)) {
          continue;
        }
        throw error;
      }
    }
  }
}

export class OmniFocusDecryptor {
  static async withDecryptedDatabase<T>(
    encryptedPath: string,
    callback: (decryptedPath: string) => Promise<T>,
    password?: string
  ): Promise<T> {
    const session = new DecryptionSession(encryptedPath, password);
    try {
      return await callback(await session.decrypt());
    } finally {
      await session.cleanup();
    }
  }

  static async isEncryptedDatabase(ofocusPath: string): Promise<boolean> {
    try {
      const stats = await stat(ofocusPath);
      if (!stats.isDirectory()) {
        return false;
      }
      const files = await readdir(ofocusPath);
      return files.includes(DocumentKey.METADATA_FILENAME);
    } catch {
      return false;
    }
  }
}

