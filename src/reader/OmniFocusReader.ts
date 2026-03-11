import * as fs from "node:fs";
import * as path from "node:path";
import JSZip from "jszip";

import { OmniFocusDecryptor } from "../crypto/OmniFocusDecryptor.js";
import { directoryExists, fileExists, statIfExists, withRetry } from "./fileUtils.js";
import { orderOmniFocusFiles } from "./patchOrdering.js";

const fsp = fs.promises;

export class OmniFocusReader {
  private static readonly BASE_ZIP_PREFIX = "00000000000000=";
  private static readonly CONTENTS_FILE = "contents.xml";

  async readAllXml(ofocusPath: string, password?: string): Promise<string[]> {
    const stats = await withRetry(() => fsp.stat(ofocusPath));
    if (stats.isDirectory()) {
      if (await OmniFocusDecryptor.isEncryptedDatabase(ofocusPath)) {
        return OmniFocusDecryptor.withDecryptedDatabase(ofocusPath, (decryptedPath) => this.readAllFromDirectory(decryptedPath), password);
      }
      return this.readAllFromDirectory(ofocusPath);
    }

    if (stats.isFile()) {
      if (ofocusPath.endsWith(".xml")) {
        return [await withRetry(() => fsp.readFile(ofocusPath, "utf-8"))];
      }
      return this.readAllFromArchive(ofocusPath);
    }

    throw new Error("Invalid OmniFocus path: must be a directory or file");
  }

  async readBaseXml(ofocusPath: string, password?: string): Promise<string> {
    const stats = await withRetry(() => fsp.stat(ofocusPath));
    if (stats.isDirectory()) {
      if (await OmniFocusDecryptor.isEncryptedDatabase(ofocusPath)) {
        return OmniFocusDecryptor.withDecryptedDatabase(ofocusPath, (decryptedPath) => this.readFromDirectory(decryptedPath), password);
      }
      return this.readFromDirectory(ofocusPath);
    }

    if (stats.isFile()) {
      if (ofocusPath.endsWith(".xml")) {
        return withRetry(() => fsp.readFile(ofocusPath, "utf-8"));
      }
      return this.readFromArchive(ofocusPath);
    }

    throw new Error("Invalid OmniFocus path: must be a directory or file");
  }

  private async readAllFromDirectory(directoryPath: string): Promise<string[]> {
    const allZipPaths = await this.findAllZipsInDirectory(directoryPath);
    if (allZipPaths.length === 1 && allZipPaths[0]?.endsWith(".xml")) {
      return [await withRetry(() => fsp.readFile(allZipPaths[0], "utf-8"))];
    }

    const xmlContents: string[] = [];
    for (const zipPath of allZipPaths) {
      xmlContents.push(await this.extractContentsFromZip(await withRetry(() => fsp.readFile(zipPath))));
    }
    return xmlContents;
  }

  private async readFromDirectory(directoryPath: string): Promise<string> {
    const baseZipPath = await this.findBaseZipInDirectory(directoryPath);
    if (baseZipPath.endsWith(".xml")) {
      return withRetry(() => fsp.readFile(baseZipPath, "utf-8"));
    }

    return this.extractContentsFromZip(await withRetry(() => fsp.readFile(baseZipPath)));
  }

  private async readAllFromArchive(archivePath: string): Promise<string[]> {
    const outerZip = await JSZip.loadAsync(await withRetry(() => fsp.readFile(archivePath)));
    const ofocusDirName = this.findOfocusDirectory(outerZip);
    const allZipNames = this.findAllZipsInArchive(outerZip, ofocusDirName);
    const xmlContents: string[] = [];

    for (const zipName of allZipNames) {
      xmlContents.push(await this.extractContentsFromZip(await outerZip.file(zipName)!.async("nodebuffer")));
    }

    return xmlContents;
  }

  private async readFromArchive(archivePath: string): Promise<string> {
    const outerZip = await JSZip.loadAsync(await withRetry(() => fsp.readFile(archivePath)));
    const ofocusDirName = this.findOfocusDirectory(outerZip);
    const baseZipName = this.findBaseZipInArchive(outerZip, ofocusDirName);
    return this.extractContentsFromZip(await outerZip.file(baseZipName)!.async("nodebuffer"));
  }

  private async findAllZipsInDirectory(directoryPath: string): Promise<string[]> {
    let entries = await withRetry(() => fsp.readdir(directoryPath));
    let zipFiles = entries
      .filter((name) => name.endsWith(".zip") && name.includes("="))
      .sort()
      .map((name) => path.join(directoryPath, name));

    if (zipFiles.length > 0) {
      return orderOmniFocusFiles(zipFiles);
    }

    const dataPath = path.join(directoryPath, "data");
    if (await directoryExists(dataPath)) {
      entries = await withRetry(() => fsp.readdir(dataPath));
      zipFiles = entries
        .filter((name) => name.endsWith(".zip") && name.includes("="))
        .sort()
        .map((name) => path.join(dataPath, name));

      if (zipFiles.length > 0) {
        return orderOmniFocusFiles(zipFiles);
      }
    }

    const xmlPath = path.join(directoryPath, OmniFocusReader.CONTENTS_FILE);
    if (await fileExists(xmlPath)) {
      return [xmlPath];
    }

    const dataXmlPath = path.join(dataPath, OmniFocusReader.CONTENTS_FILE);
    if (await fileExists(dataXmlPath)) {
      return [dataXmlPath];
    }

    const allFiles: string[] = [];
    await this.listAllFiles(directoryPath, allFiles, "", 2);
    throw new Error(
      `Unable to locate OmniFocus database in directory.\nDirectory structure:\n${allFiles.join("\n")}\nExpected one of:\n  - .zip files containing '=' character\n  - A '${OmniFocusReader.CONTENTS_FILE}' file\nin the root or 'data' subdirectory.`
    );
  }

  private async findBaseZipInDirectory(directoryPath: string): Promise<string> {
    let entries = await withRetry(() => fsp.readdir(directoryPath));
    let baseZipName = entries.find(
      (name) => name.startsWith(OmniFocusReader.BASE_ZIP_PREFIX) && name.endsWith(".zip")
    );

    if (baseZipName) {
      return path.join(directoryPath, baseZipName);
    }

    const dataPath = path.join(directoryPath, "data");
    if (await directoryExists(dataPath)) {
      entries = await withRetry(() => fsp.readdir(dataPath));
      baseZipName = entries.find(
        (name) => name.startsWith(OmniFocusReader.BASE_ZIP_PREFIX) && name.endsWith(".zip")
      );

      if (baseZipName) {
        return path.join(dataPath, baseZipName);
      }
    }

    const xmlPath = path.join(directoryPath, OmniFocusReader.CONTENTS_FILE);
    if (await fileExists(xmlPath)) {
      return xmlPath;
    }

    const dataXmlPath = path.join(dataPath, OmniFocusReader.CONTENTS_FILE);
    if (await fileExists(dataXmlPath)) {
      return dataXmlPath;
    }

    const allFiles: string[] = [];
    await this.listAllFiles(directoryPath, allFiles, "", 2);
    throw new Error(
      `Unable to locate OmniFocus database in directory.\nDirectory structure:\n${allFiles.join("\n")}\nExpected one of:\n  - A .zip file starting with '${OmniFocusReader.BASE_ZIP_PREFIX}'\n  - A '${OmniFocusReader.CONTENTS_FILE}' file\nin the root or 'data' subdirectory.`
    );
  }

  private async listAllFiles(
    dir: string,
    fileList: string[],
    prefix = "",
    maxDepth = 2,
    currentDepth = 0
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return;
    }

    try {
      const entries = await withRetry(() => fsp.readdir(dir));
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = await statIfExists(fullPath);
        if (!stats) {
          continue;
        }

        const displayPath = prefix ? path.join(prefix, entry) : entry;
        if (stats.isDirectory()) {
          fileList.push(`  ${displayPath}/`);
          await this.listAllFiles(fullPath, fileList, displayPath, maxDepth, currentDepth + 1);
        } else {
          fileList.push(`  ${displayPath}`);
        }
      }
    } catch {
      // Ignore unreadable subdirectories.
    }
  }

  private findOfocusDirectory(zip: JSZip): string {
    let ofocusDirName: string | null = null;
    zip.forEach((relativePath, file) => {
      if (!ofocusDirName && file.dir && /\.ofocus\/$/.test(relativePath)) {
        ofocusDirName = relativePath;
      }
    });

    if (!ofocusDirName) {
      throw new Error("Could not find .ofocus directory inside archive");
    }

    return ofocusDirName;
  }

  private findAllZipsInArchive(zip: JSZip, ofocusDirName: string): string[] {
    const zipFiles: string[] = [];
    zip.forEach((relativePath, file) => {
      if (!file.dir && relativePath.startsWith(ofocusDirName)) {
        const basename = relativePath.slice(ofocusDirName.length);
        if (basename.includes("=") && basename.endsWith(".zip")) {
          zipFiles.push(relativePath);
        }
      }
    });

    if (zipFiles.length === 0) {
      throw new Error("No zip files found inside ofocus archive");
    }

    return orderOmniFocusFiles(zipFiles.sort());
  }

  private findBaseZipInArchive(zip: JSZip, ofocusDirName: string): string {
    let baseZipName: string | null = null;
    zip.forEach((relativePath, file) => {
      if (!file.dir && relativePath.startsWith(ofocusDirName)) {
        const basename = relativePath.slice(ofocusDirName.length);
        if (basename.startsWith(OmniFocusReader.BASE_ZIP_PREFIX) && basename.endsWith(".zip")) {
          baseZipName = relativePath;
        }
      }
    });

    if (!baseZipName) {
      throw new Error("Base zip not found inside ofocus archive");
    }
    return baseZipName;
  }

  private async extractContentsFromZip(zipData: Buffer): Promise<string> {
    const zip = await JSZip.loadAsync(zipData);
    const contentsFile = zip.file(OmniFocusReader.CONTENTS_FILE);
    if (!contentsFile) {
      throw new Error(`${OmniFocusReader.CONTENTS_FILE} not found in zip`);
    }
    return contentsFile.async("string");
  }
}
