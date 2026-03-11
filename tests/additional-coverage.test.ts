import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecryptionError, InvalidFileFormatError, InvalidPasswordError } from "../src/errors.js";
import {
  evaluateTaskAvailability,
  isContextActive,
  isDeferred
} from "../src/filter/availabilityFilter.js";
import { deduplicateRecurringTasks } from "../src/filter/deferralFilter.js";
import { isTaskRemaining } from "../src/filter/remainingFilter.js";
import { getItemStatus } from "../src/filter/statusFilter.js";
import { TaskFilterService } from "../src/filter/TaskFilterService.js";
import { LoggerService } from "../src/logger.js";
import { TagRelationshipHandler } from "../src/parser/handlers/TagRelationshipHandler.js";
import { NoteProcessor } from "../src/parser/processors/NoteProcessor.js";
import { ParserState } from "../src/parser/utils/ParserState.js";
import { DecryptionSession, DocumentKey, OmniFocusDecryptor } from "../src/crypto/OmniFocusDecryptor.js";
import { orderOmniFocusFiles, parsePatchDescriptor } from "../src/reader/patchOrdering.js";
import { OmniFocusReader } from "../src/reader/OmniFocusReader.js";
import { renderTaskChart } from "../src/render.js";
import { createSnapshot } from "../src/snapshot.js";
import { resolveOmniFocusSource } from "../src/source/resolveOmniFocusSource.js";
import { OmniFocusFormatter } from "../src/utils/formatter.js";
import { createContext, createDocument, createFolder, createProject, createTask } from "./helpers.js";

const KEY_ID = 0x0001;
const ACTIVE_AES_CTR_HMAC = 3;
const ACTIVE_AES_WRAP = 1;
const PLAINTEXT_MASK = 5;
const KEY_MATERIAL = Buffer.from(
  "00112233445566778899aabbccddeeffffeeddccbbaa99887766554433221100",
  "hex"
);

function buildSlot(slotType: number, id: number, contents: Buffer): Buffer {
  const normalized = contents.length % 4 === 0 ? contents : Buffer.concat([contents, Buffer.alloc(4 - (contents.length % 4))]);
  return Buffer.concat([Buffer.from([slotType, normalized.length / 4, id >> 8, id & 0xff]), normalized]);
}

function buildSecretsBuffer(slots: Array<{ type: number; id: number; contents: Buffer }>): Buffer {
  let buffer = Buffer.concat([...slots.map((slot) => buildSlot(slot.type, slot.id, slot.contents)), Buffer.from([0])]);
  if (buffer.length % 8 !== 0) {
    buffer = Buffer.concat([buffer, Buffer.alloc(8 - (buffer.length % 8))]);
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
  const padding = Buffer.alloc((16 - (header.length % 16)) % 16);
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

async function createZipWithContents(xml?: string): Promise<Buffer> {
  const zip = new JSZip();
  if (xml !== undefined) {
    zip.file("contents.xml", xml);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-additional-"));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

describe("additional filter, formatter, and snapshot coverage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("covers remaining status and recurring edge cases", () => {
    const activeContext = createContext({ id: "ctx-active", name: "Work" });
    const droppedContext = createContext({ id: "ctx-dropped", status: "dropped" });
    const pausedProject = createProject({ id: "project-paused", project: { singleton: false, reviewInterval: null, lastReview: null, status: "on-hold", nextReview: null } });
    const inactiveProject = createProject({ id: "project-inactive", project: { singleton: false, reviewInterval: null, lastReview: null, status: "inactive", nextReview: null } });
    const ctx = {
      contextsMap: new Map([
        ["ctx-active", activeContext],
        ["ctx-dropped", droppedContext]
      ]),
      projectsMap: new Map([
        ["project-paused", pausedProject],
        ["project-inactive", inactiveProject]
      ]),
      tasksMap: new Map([
        ["parent-completed", createTask({ id: "parent-completed", completed: new Date("2024-01-01T00:00:00Z") })]
      ]),
      tasksByContainer: new Map<string, ReturnType<typeof createTask>[]>([
        ["project-paused", [createTask({ id: "seq-a", containerId: "project-paused", rank: null, order: null })]],
        ["blocked-parent", [createTask({ id: "blocked-child", containerId: "blocked-parent", start: new Date("2024-02-01T00:00:00Z") })]]
      ]),
      tagsByTask: new Map([
        ["tag-dropped", ["ctx-dropped"]]
      ])
    };

    expect(getItemStatus(createTask({ completed: new Date("2024-01-01T00:00:00Z") }), ctx)).toBe("completed");
    expect(getItemStatus(createTask({ completedByChildren: true }), ctx)).toBe("dropped");
    expect(getItemStatus(pausedProject, ctx)).toBe("paused");
    expect(getItemStatus(createTask({ id: "tag-dropped" }), ctx)).toBe("paused");
    expect(getItemStatus(createTask({ containerId: "project-paused" }), ctx)).toBe("paused");
    expect(getItemStatus(createTask({ start: new Date("2024-02-01T00:00:00Z") }), ctx)).toBe("deferred");
    expect(getItemStatus(createTask(), { ...ctx, tagsByTask: new Map() })).toBe("available");

    expect(isTaskRemaining(createTask({ completed: new Date("2024-01-01T00:00:00Z") }), ctx)).toBe(false);
    expect(isTaskRemaining(inactiveProject, ctx)).toBe(false);
    expect(isTaskRemaining(createTask({ contextId: "ctx-dropped" }), ctx)).toBe(false);
    expect(isTaskRemaining(createTask({ id: "tag-dropped" }), ctx)).toBe(false);
    expect(isTaskRemaining(createTask({ containerId: "project-inactive" }), ctx)).toBe(false);
    expect(isTaskRemaining(createTask({ containerId: "parent-completed" }), ctx)).toBe(false);
    expect(isTaskRemaining(createTask({ containerId: "loop" }), ctx, new Set(["loop"]))).toBe(true);

    expect(
      deduplicateRecurringTasks([
        createTask({ id: "plain" }),
        createTask({ id: "future-1", name: "Future", repetitionRule: "FREQ=DAILY", start: new Date("2024-02-01T00:00:00Z") }),
        createTask({ id: "future-2", name: "Future", repetitionRule: "FREQ=DAILY", start: new Date("2024-02-02T00:00:00Z") }),
        createTask({ id: "nostart-a", name: "NoStart", repetitionRule: "FREQ=DAILY" }),
        createTask({ id: "nostart-b", name: "NoStart", repetitionRule: "FREQ=DAILY" }),
        createTask({ id: "mixed-a", name: "MixedA", repetitionRule: "FREQ=DAILY" }),
        createTask({ id: "mixed-b", name: "MixedA", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "mixed-c", name: "MixedB", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "mixed-d", name: "MixedB", repetitionRule: "FREQ=DAILY" })
      ]).map((task) => task.id)
    ).toEqual(["plain", "nostart-a", "mixed-b", "mixed-c"]);
  });

  it("covers availability, formatter, render, and snapshot cycle branches", () => {
    const pausedTag = createContext({ id: "ctx-paused", name: "Paused", status: "paused" });
    const blockedContext = createContext({ id: "ctx-blocked", prohibitsNextAction: true });
    const activeContext = createContext({ id: "ctx-active", name: "Active" });
    const deferredProject = createProject({ id: "project-deferred", start: new Date("2024-02-01T00:00:00Z") });
    const sequentialProject = createProject({ id: "project-seq", order: "sequential" });
    const ctx = {
      contextsMap: new Map([
        ["ctx-paused", pausedTag],
        ["ctx-blocked", blockedContext],
        ["ctx-active", activeContext]
      ]),
      projectsMap: new Map([
        ["project-deferred", deferredProject],
        ["project-seq", sequentialProject]
      ]),
      tasksMap: new Map([
        ["parent-dropped", createTask({ id: "parent-dropped", completedByChildren: true })],
        ["parent-deferred", createTask({ id: "parent-deferred", start: new Date("2024-02-01T00:00:00Z") })],
        ["parent-blocked", createTask({ id: "parent-blocked", contextId: "ctx-paused" })]
      ]),
      tasksByContainer: new Map<string, ReturnType<typeof createTask>[]>([
        ["project-seq", [createTask({ id: "first", containerId: "project-seq", order: "a" }), createTask({ id: "second", containerId: "project-seq", order: "b" })]],
        ["blocked-parent", [createTask({ id: "blocked-child", containerId: "blocked-parent", completed: new Date("2024-01-01T00:00:00Z") })]]
      ]),
      tagsByTask: new Map([
        ["tag-blocked", ["ctx-paused"]]
      ])
    };

    expect(isContextActive(createContext({ parentContextId: "ctx-paused" }), ctx)).toBe(false);
    expect(isDeferred(createTask({ start: new Date("2024-02-01T00:00:00Z") }), new Date("2024-01-01T00:00:00Z"))).toBe(true);
    expect(evaluateTaskAvailability(createTask({ id: "loop" }), new Date(), new Set(["loop"]), ctx)).toBe("parent_blocked");
    expect(evaluateTaskAvailability(createTask({ hidden: true }), new Date(), new Set(), ctx)).toBe("hidden");
    expect(evaluateTaskAvailability(createTask({ completedByChildren: true }), new Date(), new Set(), ctx)).toBe("unavailable");
    expect(
      evaluateTaskAvailability(
        createProject({ project: { singleton: false, reviewInterval: null, lastReview: null, status: "inactive", nextReview: null } }),
        new Date(),
        new Set(),
        ctx
      )
    ).toBe("project_inactive");
    expect(evaluateTaskAvailability(createTask({ contextId: "ctx-paused" }), new Date(), new Set(), ctx)).toBe("blocked_by_context");
    expect(evaluateTaskAvailability(createTask({ id: "tag-blocked" }), new Date(), new Set(), ctx)).toBe("blocked_by_tag");
    expect(evaluateTaskAvailability(createTask({ start: new Date("2024-02-01T00:00:00Z") }), new Date("2024-01-01T00:00:00Z"), new Set(), ctx)).toBe("deferred");
    expect(evaluateTaskAvailability(createTask({ containerId: "project-deferred" }), new Date(), new Set(), ctx)).toBe("parent_blocked");
    expect(evaluateTaskAvailability(createTask({ containerId: "parent-dropped" }), new Date(), new Set(), ctx)).toBe("parent_blocked");
    expect(evaluateTaskAvailability(createTask({ containerId: "parent-deferred" }), new Date(), new Set(), ctx)).toBe("parent_blocked");
    expect(evaluateTaskAvailability(createTask({ containerId: "parent-blocked" }), new Date(), new Set(), ctx)).toBe("parent_blocked");
    expect(evaluateTaskAvailability(createTask({ id: "second", containerId: "project-seq", order: "b" }), new Date(), new Set(), ctx)).toBe("blocked_by_project");
    expect(evaluateTaskAvailability(createTask({ id: "blocked-parent" }), new Date(), new Set(), ctx)).toBe("child_blocked");

    expect(OmniFocusFormatter.getTaskAttributes(createTask({ estimatedMinutes: 130, flagged: true, availabilityStatus: "blocked_by_project" }))).toEqual([
      "est:2h10m",
      "flagged",
      "blocked:project"
    ]);
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ estimatedMinutes: 30, availabilityStatus: "blocked_by_context" }))).toContain("blocked:context");
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ availabilityStatus: "blocked_by_tag" }))).toContain("blocked:tag");
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ availabilityStatus: "parent_blocked" }))).toContain("blocked:parent");
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ availabilityStatus: "child_blocked" }))).toContain("blocked:child");
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ availabilityStatus: "project_inactive" }))).toContain("blocked:project-inactive");
    expect(OmniFocusFormatter.getTaskAttributes(createTask({ availabilityStatus: "deferred" }))).toContain("deferred");
    expect(OmniFocusFormatter.getProjectType(createProject({ project: { singleton: true, reviewInterval: null, lastReview: null, status: "active", nextReview: null } }))).toBe("actionlist");
    expect(OmniFocusFormatter.getProjectType(createProject({ order: "parallel" }))).toBe("parallel");
    expect(OmniFocusFormatter.getProjectType(createProject({ order: null, project: { singleton: false, reviewInterval: null, lastReview: null, status: "active", nextReview: null } }))).toBeNull();
    expect(OmniFocusFormatter.getProjectAttributes(createProject({ contextId: "ctx-active", project: { singleton: false, reviewInterval: "@1w", lastReview: null, status: "paused", nextReview: null } }), new Map([["ctx-active", activeContext]]))).toContain("@Active");
    expect(OmniFocusFormatter.getContextAttributes(createContext({ status: "dropped" }))).toEqual(["dropped"]);
    expect(OmniFocusFormatter.getContextAttributes(createContext({ status: "paused" }))).toEqual(["paused"]);
    expect(OmniFocusFormatter.getContextAttributes(createContext())).toEqual([]);

    const document = createDocument({
      contexts: [activeContext, pausedTag],
      folders: [createFolder({ id: "folder-1", name: "Folder" }), createFolder({ id: "folder-2", name: "Folder 2" })],
      projects: [
        createProject({ id: "project-1", containerId: "folder-1", name: "Project", note: "<p>project note</p>" }),
        createProject({ id: "project-2", containerId: "folder-2", name: "Project 2" })
      ],
      tasks: [
        createTask({ id: "done-task", name: "Done", containerId: "project-1", completed: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "todo-task", name: "Todo", containerId: "project-1", note: "<p>this is a very long note</p>" }),
        createTask({ id: "other-task", name: "Other", containerId: "project-2" }),
        createTask({ id: "inbox-task", name: "Inbox", inbox: true })
      ]
    });
    const chart = renderTaskChart(createSnapshot(document, "all"), { noteMaxLength: 10 });
    expect(chart).toContain("[x] Done");
    expect(chart).toContain("[ ] Todo");
    expect(chart).toContain("project...");

    const filterProjectsSpy = vi.spyOn(TaskFilterService.prototype, "filterProjects");
    const filterTasksSpy = vi.spyOn(TaskFilterService.prototype, "filterTasks");
    filterProjectsSpy.mockReturnValue([createProject({ id: "cycle-project" })]);
    filterTasksSpy.mockReturnValue([
      createTask({ id: "a", containerId: "b" }),
      createTask({ id: "b", containerId: "a" })
    ]);
    expect(
      createSnapshot(
        createDocument({
          projects: [createProject({ id: "cycle-project" })],
          tasks: [createTask({ id: "a", containerId: "b" }), createTask({ id: "b", containerId: "a" })]
        }),
        "available"
      ).filtered.projects
    ).toEqual([]);

    filterProjectsSpy.mockReturnValue([
      createProject({
        id: "drop-project",
        project: { singleton: false, reviewInterval: null, lastReview: null, status: "dropped", nextReview: null }
      })
    ]);
    filterTasksSpy.mockReturnValue([]);
    expect(createSnapshot(createDocument(), "available").filtered.projects).toEqual([]);
  });
});

describe("additional source, ordering, reader, and decryptor coverage", () => {
  const previousLocal = process.env.OMNIFOCUS_LOCAL_PATH;
  const previousVault = process.env.OMNIFOCUS_VAULT_PATH;
  const previousPassword = process.env.OMNIFOCUS_PASSWORD;

  afterEach(() => {
    process.env.OMNIFOCUS_LOCAL_PATH = previousLocal;
    process.env.OMNIFOCUS_VAULT_PATH = previousVault;
    process.env.OMNIFOCUS_PASSWORD = previousPassword;
    vi.restoreAllMocks();
  });

  it("covers source resolution and patch ordering failures", async () => {
    process.env.OMNIFOCUS_LOCAL_PATH = "";
    process.env.OMNIFOCUS_VAULT_PATH = "";
    vi.spyOn(fs.promises, "access").mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    await expect(resolveOmniFocusSource({ source: "local" })).rejects.toThrow("local OmniFocus");
    await expect(resolveOmniFocusSource()).rejects.toThrow("auto-detect");

    expect(parsePatchDescriptor("/tmp/file.txt")).toBeNull();
    expect(parsePatchDescriptor("/tmp/20240101=nope.zip")).toBeNull();
    expect(parsePatchDescriptor("/tmp/20240101=a+b.txt")).toBeNull();
    expect(orderOmniFocusFiles(["/tmp/one.zip"])).toEqual(["/tmp/one.zip"]);
    expect(orderOmniFocusFiles(["/tmp/20240101000000=a+b.zip", "/tmp/20240102000000=b+c.zip"])).toEqual([
      "/tmp/20240101000000=a+b.zip",
      "/tmp/20240102000000=b+c.zip"
    ]);
    expect(
      orderOmniFocusFiles([
        "/tmp/00000000000000=base+root.zip",
        "/tmp/20240101000000=root+leaf.zip",
        "/tmp/20240101000000=leaf+branch.zip",
        "/tmp/passthrough.txt"
      ])
    ).toEqual([
      "/tmp/00000000000000=base+root.zip",
      "/tmp/20240101000000=root+leaf.zip",
      "/tmp/20240101000000=leaf+branch.zip",
      "/tmp/passthrough.txt"
    ]);
  });

  it("covers reader internals across directory and archive fallbacks", async () => {
    await withTempDir(async (tempDir) => {
      const reader = new OmniFocusReader() as unknown as {
        findAllZipsInDirectory: (directoryPath: string) => Promise<string[]>;
        findBaseZipInDirectory: (directoryPath: string) => Promise<string>;
        listAllFiles: (dir: string, fileList: string[], prefix?: string, maxDepth?: number, currentDepth?: number) => Promise<void>;
        findAllZipsInArchive: (zip: JSZip, ofocusDirName: string) => string[];
        extractContentsFromZip: (zipData: Buffer) => Promise<string>;
      };

      const dataDir = path.join(tempDir, "vault.ofocus");
      await fs.promises.mkdir(path.join(dataDir, "data"), { recursive: true });
      await fs.promises.writeFile(path.join(dataDir, "data", "00000000000000=base+root.zip"), await createZipWithContents("<omnifocus/>"));
      await fs.promises.writeFile(path.join(dataDir, "data", "20240101000000=root+leaf.zip"), await createZipWithContents("<patch/>"));
      expect(await reader.findAllZipsInDirectory(dataDir)).toEqual([
        path.join(dataDir, "data", "00000000000000=base+root.zip"),
        path.join(dataDir, "data", "20240101000000=root+leaf.zip")
      ]);
      expect(await reader.findBaseZipInDirectory(dataDir)).toBe(path.join(dataDir, "data", "00000000000000=base+root.zip"));

      const xmlDir = path.join(tempDir, "xml.ofocus");
      await fs.promises.mkdir(xmlDir);
      await fs.promises.writeFile(path.join(xmlDir, "contents.xml"), "<omnifocus />");
      expect(await reader.findAllZipsInDirectory(xmlDir)).toEqual([path.join(xmlDir, "contents.xml")]);
      expect(await reader.findBaseZipInDirectory(xmlDir)).toBe(path.join(xmlDir, "contents.xml"));

      const fileList: string[] = [];
      await fs.promises.mkdir(path.join(xmlDir, "child"));
      await fs.promises.writeFile(path.join(xmlDir, "child", "note.txt"), "hello");
      await reader.listAllFiles(xmlDir, fileList);
      expect(fileList.some((entry) => entry.endsWith("child/"))).toBe(true);
      expect(fileList.some((entry) => entry.endsWith("contents.xml"))).toBe(true);
      await reader.listAllFiles(xmlDir, [], "", 1, 1);

      const zip = new JSZip();
      zip.folder("Broken.ofocus");
      zip.file("Broken.ofocus/plain.txt", "hello");
      expect(() => reader.findAllZipsInArchive(zip, "Broken.ofocus/")).toThrow("No zip files found");
      await expect(reader.extractContentsFromZip(await createZipWithContents())).rejects.toThrow("contents.xml not found");
    });
  });

  it("covers decryptor helper branches and decryption session internals", async () => {
    const decryptingDocKey = new DocumentKey(buildSecretsBuffer([{ type: ACTIVE_AES_CTR_HMAC, id: KEY_ID, contents: KEY_MATERIAL }]));
    const maskedDocKey = new DocumentKey(
      buildSecretsBuffer([
        { type: ACTIVE_AES_CTR_HMAC, id: KEY_ID, contents: KEY_MATERIAL },
        { type: PLAINTEXT_MASK, id: 2, contents: Buffer.from(".txt\0\0") }
      ])
    );

    expect(() =>
      DocumentKey.usePassphrase(
        { method: "password", algorithm: "unknown", rounds: 1, salt: Buffer.from("salt"), key: Buffer.alloc(0) } as never,
        "secret"
      )
    ).toThrow(InvalidPasswordError);
    expect(() => decryptingDocKey.getDecryptor(Buffer.from([0, 1, 0xff]))).toThrow(DecryptionError);
    expect(() => new DocumentKey(buildSecretsBuffer([{ type: 99, id: KEY_ID, contents: KEY_MATERIAL }])).getDecryptor(Buffer.from([0, 1]))).toThrow(
      "Unknown keyslot type"
    );
    expect(maskedDocKey.applicablePolicySlots("hello.txt")).toHaveLength(1);

    const wrapKey = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const wrappedDocKey = new DocumentKey(buildSecretsBuffer([{ type: ACTIVE_AES_WRAP, id: KEY_ID, contents: wrapKey }]));
    expect(() => wrappedDocKey.getDecryptor(Buffer.concat([Buffer.from([0, 1]), Buffer.from([0, 1, 2])]))).toThrow("AESWRAPped info length");
    expect(() => wrappedDocKey.getDecryptor(Buffer.concat([Buffer.from([0, 1]), aesKeyWrap(KEY_MATERIAL, wrapKey)]))).not.toThrow();

    const helper = decryptingDocKey.getDecryptor(Buffer.from([0, 1])) as unknown as {
      checkHmac: (buffer: Buffer, segmentsStart: number, segmentsEnd: number, fileHmac: Buffer) => void;
    };
    expect(() => helper.checkHmac(Buffer.alloc(8), 0, 1, Buffer.alloc(32))).toThrow("Segment position error");

    await withTempDir(async (tempDir) => {
      const plaintextPath = path.join(tempDir, "notes.txt");
      await fs.promises.writeFile(plaintextPath, "contains crypt token");
      await expect(maskedDocKey.decryptFile("notes.txt", plaintextPath, path.join(tempDir, "out.txt"))).rejects.toThrow(InvalidFileFormatError);

      const encryptedPath = path.join(tempDir, "payload.ofocus");
      const outputPath = path.join(tempDir, "payload.out");
      const encryptedBuffer = createEncryptedFileBuffer(Buffer.from("segment"), KEY_MATERIAL, KEY_ID);
      encryptedBuffer[40] ^= 0xff;
      await fs.promises.writeFile(encryptedPath, encryptedBuffer);
      await expect(decryptingDocKey.decryptFile("payload.ofocus", encryptedPath, outputPath)).rejects.toThrow("Segment 0 MAC verification failed");

      const session = new DecryptionSession(tempDir, "secret") as unknown as {
        decryptDirectory: (indir: string, outdir: string) => Promise<void>;
        processDirectory: (indir: string, outdir: string, documentKey: { decryptFile: (name: string, inputPath: string, outputPath: string) => Promise<void> }, relativePath: string) => Promise<void>;
      };
      const notDir = path.join(tempDir, "not-a-directory");
      await fs.promises.writeFile(notDir, "file");
      await expect(session.decryptDirectory(notDir, path.join(tempDir, "out"))).rejects.toThrow("is not a directory");

      const emptyDir = path.join(tempDir, "empty");
      await fs.promises.mkdir(emptyDir);
      await expect(session.decryptDirectory(emptyDir, path.join(tempDir, "out-empty"))).rejects.toThrow("Expected to find 'encrypted'");

      const inputDir = path.join(tempDir, "input");
      const outputDir = path.join(tempDir, "output");
      await fs.promises.mkdir(path.join(inputDir, "sub"), { recursive: true });
      await fs.promises.writeFile(path.join(inputDir, "encrypted"), "meta");
      await fs.promises.writeFile(path.join(inputDir, "file-1"), "a");
      await fs.promises.writeFile(path.join(inputDir, "file-2"), "b");
      await fs.promises.mkdir(outputDir, { recursive: true });

      const transientKey = {
        decryptFile: vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }))
          .mockResolvedValueOnce(undefined)
      };
      await expect(session.processDirectory(inputDir, outputDir, transientKey, "")).rejects.toMatchObject({ code: "EBUSY" });
      expect(transientKey.decryptFile).toHaveBeenCalledTimes(1);

      const throwingKey = {
        decryptFile: vi.fn().mockRejectedValue(new Error("boom"))
      };
      await expect(session.processDirectory(inputDir, outputDir, throwingKey, "")).rejects.toThrow("boom");

      const plainFile = path.join(tempDir, "plain-file");
      await fs.promises.writeFile(plainFile, "hi");
      expect(await OmniFocusDecryptor.isEncryptedDatabase(plainFile)).toBe(false);
      process.env.OMNIFOCUS_PASSWORD = "";
      expect(() => new DecryptionSession(tempDir)).toThrow(InvalidPasswordError);
    });
  });
});

describe("additional parser processor coverage", () => {
  it("covers note and tag relationship guard branches", () => {
    const state = new ParserState();
    const noteProcessor = new NoteProcessor(state);
    const tagRelationshipHandler = new TagRelationshipHandler(state);
    const logger = new LoggerService();

    logger.logParseError(new Error("parse"), "ctx");
    logger.logParseError(new Error("plain"));

    noteProcessor.startNoteCollection();
    noteProcessor.appendOpenTag("span", { class: "x" }, true);
    noteProcessor.appendText("text");
    expect(noteProcessor.handleNoteEnd("span")).toBe(false);
    expect(noteProcessor.isCollecting()).toBe(true);
    expect(noteProcessor.handleNoteEnd("note")).toBe(true);

    tagRelationshipHandler.handleTaskToTagStart({});
    tagRelationshipHandler.handleInboxTask({});
    tagRelationshipHandler.handleInboxTask({ id: "a", op: "reference" });
    expect(state.inboxTaskIds.size).toBe(0);
  });
});
