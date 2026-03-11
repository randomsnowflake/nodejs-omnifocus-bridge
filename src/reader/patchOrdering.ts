import * as path from "node:path";

const BASE_ZIP_PREFIX = "00000000000000=";

type PatchDescriptor = {
  filePath: string;
  fileName: string;
  timestamp: string;
  fromId: string;
  toId: string;
  isBase: boolean;
};

export function parsePatchDescriptor(filePath: string): PatchDescriptor | null {
  const fileName = path.basename(filePath);
  if (!fileName.endsWith(".zip") || !fileName.includes("=")) {
    return null;
  }

  const [timestamp, remainder] = fileName.split("=");
  if (!remainder) {
    return null;
  }

  const parts = remainder.split("+");
  if (parts.length < 2) {
    return null;
  }

  const fromId = parts[0];
  const toWithExt = parts.at(-1);
  if (!fromId || !toWithExt || !toWithExt.endsWith(".zip")) {
    return null;
  }

  return {
    filePath,
    fileName,
    timestamp,
    fromId,
    toId: toWithExt.slice(0, -4),
    isBase: timestamp === BASE_ZIP_PREFIX.slice(0, 14)
  };
}

export function orderOmniFocusFiles(zipFiles: string[]): string[] {
  if (zipFiles.length <= 1) {
    return zipFiles;
  }

  const descriptors: PatchDescriptor[] = [];
  const passthrough: string[] = [];

  for (const entry of zipFiles) {
    const descriptor = parsePatchDescriptor(entry);
    if (descriptor) {
      descriptors.push(descriptor);
    } else {
      passthrough.push(entry);
    }
  }

  const baseDescriptor = descriptors.find((descriptor) => descriptor.isBase);
  if (!baseDescriptor) {
    return zipFiles;
  }

  const patches = descriptors.filter((descriptor) => !descriptor.isBase);
  const compareDescriptors = (a: PatchDescriptor, b: PatchDescriptor) =>
    a.timestamp === b.timestamp ? a.fileName.localeCompare(b.fileName) : a.timestamp.localeCompare(b.timestamp);

  const producedById = new Map<string, PatchDescriptor[]>();
  const dependentsById = new Map<string, PatchDescriptor[]>();

  for (const patch of patches) {
    const producedList = producedById.get(patch.toId) ?? [];
    producedList.push(patch);
    producedById.set(patch.toId, producedList);

    const dependentList = dependentsById.get(patch.fromId) ?? [];
    dependentList.push(patch);
    dependentsById.set(patch.fromId, dependentList);
  }

  const inDegree = new Map<string, number>();
  for (const patch of patches) {
    inDegree.set(patch.fileName, (producedById.get(patch.fromId) ?? []).length);
  }

  const available = patches.filter((patch) => (inDegree.get(patch.fileName) ?? 0) === 0).sort(compareDescriptors);
  const orderedPatchDescriptors: PatchDescriptor[] = [];
  const visited = new Set<string>([baseDescriptor.fileName]);

  while (available.length > 0) {
    const next = available.shift();
    if (!next || visited.has(next.fileName)) {
      continue;
    }

    orderedPatchDescriptors.push(next);
    visited.add(next.fileName);

    for (const dependent of dependentsById.get(next.toId) ?? []) {
      if (visited.has(dependent.fileName)) {
        continue;
      }

      const newDegree = Math.max(0, (inDegree.get(dependent.fileName) ?? 0) - 1);
      inDegree.set(dependent.fileName, newDegree);
      if (newDegree === 0) {
        available.push(dependent);
      }
    }

    available.sort(compareDescriptors);
  }

  const orderedPaths = [
    baseDescriptor.filePath,
    ...orderedPatchDescriptors.map((descriptor) => descriptor.filePath),
    ...patches.filter((patch) => !visited.has(patch.fileName)).sort(compareDescriptors).map((descriptor) => descriptor.filePath)
  ];

  const seen = new Set(orderedPaths);
  for (const entry of [...zipFiles, ...passthrough]) {
    if (!seen.has(entry)) {
      orderedPaths.push(entry);
      seen.add(entry);
    }
  }

  return orderedPaths;
}

