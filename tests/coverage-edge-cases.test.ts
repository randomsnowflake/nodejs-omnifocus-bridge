import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DecryptionSession, DocumentKey, InvalidFileFormatError, InvalidPasswordError } from "../src/crypto/OmniFocusDecryptor.js";
import { TaskFilterService } from "../src/filter/TaskFilterService.js";
import {
  evaluateTaskAvailability,
  getContextBlocker,
  isContextActive,
  isDeferred,
  isDroppedOrCanceled,
  isProjectStatusActive
} from "../src/filter/availabilityFilter.js";
import { deduplicateRecurringTasks } from "../src/filter/deferralFilter.js";
import { isTaskRemaining } from "../src/filter/remainingFilter.js";
import { getItemStatus } from "../src/filter/statusFilter.js";
import { LogLevel, LoggerService } from "../src/logger.js";
import { OmniFocusReader } from "../src/reader/OmniFocusReader.js";
import { createContextTree, createInboxTree, createProjectTree, createSnapshot } from "../src/snapshot.js";
import { createContext, createDocument, createFolder, createProject, createTask } from "./helpers.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "omnifocus-edges-"));
  try {
    return await callback(tempDir);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function createZip(bufferContent?: string): Promise<Buffer> {
  const zip = new JSZip();
  if (bufferContent !== undefined) {
    zip.file("contents.xml", bufferContent);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("coverage edge cases", () => {
  it("covers logger non-printing branch and status helpers", () => {
    const quietLogger = new LoggerService(LogLevel.ERROR);
    quietLogger.log(LogLevel.DEBUG, "ignored");
    quietLogger.log(LogLevel.INFO, "ignored");
    quietLogger.log(LogLevel.WARN, "ignored");
    expect(quietLogger.getSummary()).toEqual({
      unknownElements: 0,
      unknownAttributes: 0,
      unknownValues: 0
    });

    expect(isProjectStatusActive(undefined)).toBe(true);
    expect(isProjectStatusActive("done")).toBe(false);
    expect(isDroppedOrCanceled(createTask({ completedByChildren: true }))).toBe(true);
    expect(isDeferred(createTask(), new Date())).toBe(false);
  });

  it("covers direct filter edge cases", () => {
    const parentPaused = createProject({
      id: "project-paused",
      project: { singleton: false, reviewInterval: null, lastReview: null, status: "paused", nextReview: null }
    });
    const activeContext = createContext({ id: "ctx-active" });
    const pausedContext = createContext({ id: "ctx-paused", status: "paused" });
    const child = createTask({ id: "child", containerId: "parent" });
    const parent = createTask({ id: "parent" });
    const ctx = {
      contextsMap: new Map([
        ["ctx-active", activeContext],
        ["ctx-paused", pausedContext]
      ]),
      projectsMap: new Map([
        ["project-paused", parentPaused],
        ["project-seq", createProject({ id: "project-seq", order: "sequential" })]
      ]),
      tasksMap: new Map([
        ["parent", parent],
        ["child", child]
      ]),
      tasksByContainer: new Map<string, ReturnType<typeof createTask>[]>([
        ["project-seq", [createTask({ id: "seq-1", containerId: "project-seq", rank: 1 }), createTask({ id: "seq-2", containerId: "project-seq", rank: 2 })]],
        ["parent", [child]]
      ]),
      tagsByTask: new Map([["tagged", ["ctx-paused"]]])
    };

    expect(isContextActive(createContext({ id: "nested", parentContextId: "ctx-paused" }), ctx)).toBe(false);
    expect(getContextBlocker(createTask({ id: "tagged" }), ctx)).toBe("blocked_by_tag");
    expect(evaluateTaskAvailability(createTask({ id: "hidden", hidden: true }), new Date(), new Set(), ctx)).toBe("hidden");
    expect(evaluateTaskAvailability(createTask({ id: "done", completed: new Date() }), new Date(), new Set(), ctx)).toBe("unavailable");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "project-member", containerId: "project-paused", contextId: "ctx-active" }),
        new Date(),
        new Set(),
        ctx
      )
    ).toBe("parent_blocked");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "ctx-blocked", contextId: "ctx-paused" }),
        new Date(),
        new Set(),
        ctx
      )
    ).toBe("blocked_by_context");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "deferred", start: new Date("2999-01-01T00:00:00Z") }),
        new Date("2024-01-01T00:00:00Z"),
        new Set(),
        ctx
      )
    ).toBe("deferred");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "seq-2", containerId: "project-seq", rank: 2 }),
        new Date(),
        new Set(),
        ctx
      )
    ).toBe("blocked_by_project");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "child-parent", containerId: "parent" }),
        new Date(),
        new Set(["child-parent"]),
        ctx
      )
    ).toBe("parent_blocked");
    expect(
      evaluateTaskAvailability(
        createTask({ id: "project-inactive", type: "project", isProject: true, project: { singleton: false, reviewInterval: null, lastReview: null, status: "inactive", nextReview: null } }),
        new Date(),
        new Set(),
        ctx
      )
    ).toBe("project_inactive");

    expect(
      isTaskRemaining(
        createTask({ id: "remaining-parent", containerId: "parent", contextId: "ctx-active" }),
        {
          contextsMap: ctx.contextsMap,
          projectsMap: ctx.projectsMap,
          tasksMap: ctx.tasksMap,
          tagsByTask: new Map([["remaining-parent", ["ctx-paused"]]])
        }
      )
    ).toBe(true);
    expect(
      getItemStatus(createTask({ id: "status-parent", containerId: "project-paused" }), ctx)
    ).toBe("paused");
    expect(
      getItemStatus(createTask({ id: "status-tagged", contextId: "ctx-paused" }), ctx)
    ).toBe("paused");
    expect(
      getItemStatus(createTask({ id: "status-available" }), { ...ctx, tagsByTask: new Map() })
    ).toBe("available");
    expect(
      deduplicateRecurringTasks([
        createTask({ id: "future", repetitionRule: "FREQ=DAILY", start: new Date("2999-01-01T00:00:00Z") })
      ])
    ).toHaveLength(1);

    const service = new TaskFilterService();
    service.setDocument(createDocument({ projects: [parentPaused], contexts: [pausedContext], tasks: [createTask({ id: "status-task", contextId: "ctx-paused" })] }));
    expect(service.getItemStatus(createTask({ id: "status-task", contextId: "ctx-paused" }))).toBe("paused");
  });

  it("covers snapshot tree edge cases", () => {
    const hiddenFolder = createFolder({ id: "hidden-folder", hidden: true });
    const visibleFolder = createFolder({ id: "visible-folder", rank: 2 });
    const droppedProject = createProject({
      id: "dropped-project",
      containerId: "visible-folder",
      project: { singleton: false, reviewInterval: null, lastReview: null, status: "dropped", nextReview: null }
    });
    const visibleProject = createProject({ id: "visible-project", containerId: "visible-folder", rank: 1 });
    const orphanTask = createTask({ id: "orphan-task", containerId: "missing-parent", inbox: true });
    const nestedTask = createTask({ id: "nested-task", containerId: "visible-project" });
    const document = createDocument({
      contexts: [createContext({ id: "ctx-1", rank: 2 }), createContext({ id: "ctx-2", parentContextId: "missing", rank: 1 })],
      folders: [hiddenFolder, visibleFolder],
      projects: [droppedProject, visibleProject],
      tasks: [orphanTask, nestedTask]
    });

    const availableSnapshot = createSnapshot(document, "available");
    expect(createInboxTree(availableSnapshot).map((node) => node.id)).toEqual(["orphan-task"]);
    expect(createProjectTree(availableSnapshot)[0]?.id).toBe("visible-folder");

    const allSnapshot = createSnapshot(document, "all");
    expect(createProjectTree(allSnapshot).some((node) => node.id === "visible-folder")).toBe(true);
    expect(createContextTree(allSnapshot)[0]?.id).toBe("ctx-2");
  });

  it("covers reader error branches and decryptor error conditions", async () => {
    await withTempDir(async (tempDir) => {
      const reader = new OmniFocusReader();
      const archiveWithoutFolder = path.join(tempDir, "bad-archive.zip");
      const zip = new JSZip();
      zip.file("plain.txt", "hello");
      await fs.promises.writeFile(archiveWithoutFolder, await zip.generateAsync({ type: "nodebuffer" }));
      await expect(reader.readBaseXml(archiveWithoutFolder)).rejects.toThrow("Could not find .ofocus directory");

      const archiveWithoutZip = path.join(tempDir, "nozip-archive.zip");
      const zipNoInner = new JSZip();
      zipNoInner.folder("Bad.ofocus");
      await fs.promises.writeFile(archiveWithoutZip, await zipNoInner.generateAsync({ type: "nodebuffer" }));
      await expect(reader.readAllXml(archiveWithoutZip)).rejects.toThrow("No zip files found");

      const archiveWithoutBase = path.join(tempDir, "nobase-archive.zip");
      const zipNoBase = new JSZip();
      zipNoBase.folder("Bad.ofocus");
      zipNoBase.file("Bad.ofocus/20240101000000=a+b.zip", await createZip("<omnifocus />"));
      await fs.promises.writeFile(archiveWithoutBase, await zipNoBase.generateAsync({ type: "nodebuffer" }));
      await expect(reader.readBaseXml(archiveWithoutBase)).rejects.toThrow("Base zip not found");

      const archiveMissingContents = path.join(tempDir, "missing-contents.zip");
      const zipMissingContents = new JSZip();
      zipMissingContents.folder("Bad.ofocus");
      zipMissingContents.file("Bad.ofocus/00000000000000=base+root.zip", await new JSZip().generateAsync({ type: "nodebuffer" }));
      await fs.promises.writeFile(archiveMissingContents, await zipMissingContents.generateAsync({ type: "nodebuffer" }));
      await expect(reader.readBaseXml(archiveMissingContents)).rejects.toThrow("contents.xml not found");

      const vaultPath = path.join(tempDir, "invalid-vault.ofocus");
      await fs.promises.mkdir(vaultPath);
      await expect(new DecryptionSession(vaultPath, "secret").decrypt()).rejects.toThrow(InvalidFileFormatError);

      const secrets = Buffer.concat([Buffer.from([1, 1, 0, 1]), Buffer.alloc(4), Buffer.from([0])]);
      const key = new DocumentKey(secrets);
      await fs.promises.writeFile(path.join(tempDir, "plain.bin"), "not encrypted");
      await expect(key.decryptFile("plain.bin", path.join(tempDir, "plain.bin"), path.join(tempDir, "out.bin"))).rejects.toThrow(
        InvalidFileFormatError
      );

      expect(() => new DecryptionSession(vaultPath)).toThrow(InvalidPasswordError);
    });
  });
});
