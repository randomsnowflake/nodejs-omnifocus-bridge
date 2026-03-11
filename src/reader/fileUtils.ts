import * as fs from "node:fs";

const fsp = fs.promises;

export function isTransientFileError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  const code = (error as { code: string }).code;
  return code === "EACCES" || code === "ENOENT" || code === "EBUSY";
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 100
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFileError(error) || attempt === maxRetries) {
        throw error;
      }

      const delay = initialDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export async function statIfExists(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await withRetry(() => fsp.stat(targetPath));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function directoryExists(targetPath: string): Promise<boolean> {
  return (await statIfExists(targetPath))?.isDirectory() ?? false;
}

export async function fileExists(targetPath: string): Promise<boolean> {
  return (await statIfExists(targetPath))?.isFile() ?? false;
}

