import * as fs from "node:fs";

import { isTransientFileError, withRetry } from "../reader/fileUtils.js";

const readFileAsync = fs.promises.readFile;
const statAsync = fs.promises.stat;
const readdirAsync = fs.promises.readdir;

export const readFile = (filePath: fs.PathLike): Promise<Buffer> => withRetry(() => readFileAsync(filePath));
export const stat = (filePath: fs.PathLike): Promise<fs.Stats> => withRetry(() => statAsync(filePath));

export async function readdir(dirPath: fs.PathLike): Promise<string[]>;
export async function readdir(dirPath: fs.PathLike, options: { withFileTypes: true }): Promise<fs.Dirent[]>;
export async function readdir(
  dirPath: fs.PathLike,
  options?: { withFileTypes?: boolean }
): Promise<string[] | fs.Dirent[]> {
  if (options?.withFileTypes) {
    return withRetry(() => readdirAsync(dirPath, { withFileTypes: true }));
  }

  return withRetry(() => readdirAsync(dirPath));
}

export { isTransientFileError };

