import { LoggerService } from "./logger.js";
import { SaxOmniFocusParser } from "./parser/SaxOmniFocusParser.js";
import { OmniFocusReader } from "./reader/OmniFocusReader.js";
import { resolveOmniFocusSource } from "./source/resolveOmniFocusSource.js";
import type { OmniFocusDocument, OmniFocusReaderOptions } from "./types.js";

export async function readOmniFocus(
  input?: string | OmniFocusReaderOptions,
  options: OmniFocusReaderOptions = {}
): Promise<OmniFocusDocument> {
  const resolvedOptions = typeof input === "string" ? { ...options, path: input } : { ...input, ...options };
  const source = await resolveOmniFocusSource(resolvedOptions);
  const reader = new OmniFocusReader();
  const parser = new SaxOmniFocusParser(new LoggerService());

  const xmlStrings = resolvedOptions.readAllPatches === false
    ? [await reader.readBaseXml(source.path, resolvedOptions.password)]
    : await reader.readAllXml(source.path, resolvedOptions.password);

  return parser.parseMultiple(xmlStrings, source.path);
}

