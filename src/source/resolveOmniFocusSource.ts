import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { OmniFocusDecryptor } from "../crypto/OmniFocusDecryptor.js";
import type { OmniFocusReaderOptions, OmniFocusSourceResolution } from "../types.js";

const DEFAULT_LOCAL_PATHS = [
  "~/Library/Containers/com.omnigroup.OmniFocus4/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus",
  "~/Library/Containers/com.omnigroup.OmniFocus3/Data/Library/Application Support/OmniFocus/OmniFocus.ofocus"
];

function expandHome(inputPath: string): string {
  return inputPath.startsWith("~/") ? path.join(os.homedir(), inputPath.slice(2)) : inputPath;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePathType(targetPath: string): Promise<"local" | "vault"> {
  return (await OmniFocusDecryptor.isEncryptedDatabase(targetPath)) ? "vault" : "local";
}

export async function resolveOmniFocusSource(options: OmniFocusReaderOptions = {}): Promise<OmniFocusSourceResolution> {
  const explicitPath = options.path ? path.resolve(expandHome(options.path)) : undefined;
  const localEnvPath = process.env.OMNIFOCUS_LOCAL_PATH ? path.resolve(expandHome(process.env.OMNIFOCUS_LOCAL_PATH)) : undefined;
  const vaultEnvPath = process.env.OMNIFOCUS_VAULT_PATH ? path.resolve(expandHome(process.env.OMNIFOCUS_VAULT_PATH)) : undefined;

  if (options.source === "local") {
    const candidates = [explicitPath, localEnvPath, ...DEFAULT_LOCAL_PATHS.map((candidate) => path.resolve(expandHome(candidate)))];
    const found = await firstExistingPath(candidates);
    if (!found) {
      throw new Error("Unable to resolve a local OmniFocus database path.");
    }
    return { source: "local", path: found };
  }

  if (options.source === "vault") {
    const candidates = [explicitPath, vaultEnvPath];
    const found = await firstExistingPath(candidates);
    if (!found) {
      throw new Error("Unable to resolve an OmniFocus vault path.");
    }
    return { source: "vault", path: found };
  }

  if (explicitPath) {
    if (!(await pathExists(explicitPath))) {
      throw new Error(`Provided OmniFocus path does not exist: ${explicitPath}`);
    }
    return { source: await resolvePathType(explicitPath), path: explicitPath };
  }

  const autoCandidates: Array<{ source: "local" | "vault"; path?: string }> = [
    { source: "local", path: localEnvPath },
    ...DEFAULT_LOCAL_PATHS.map((candidate) => ({ source: "local" as const, path: path.resolve(expandHome(candidate)) })),
    { source: "vault", path: vaultEnvPath }
  ];

  for (const candidate of autoCandidates) {
    if (!candidate.path) {
      continue;
    }
    if (await pathExists(candidate.path)) {
      return { source: candidate.source, path: candidate.path };
    }
  }

  throw new Error("Unable to auto-detect an OmniFocus data source.");
}

async function firstExistingPath(candidates: Array<string | undefined>): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (candidate && (await pathExists(candidate))) {
      return candidate;
    }
  }
  return undefined;
}
