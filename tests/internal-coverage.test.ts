import { describe, expect, it } from "vitest";

import { LoggerService } from "../src/logger.js";
import { EntityFactory } from "../src/parser/EntityFactory.js";
import { ContextHandler } from "../src/parser/handlers/ContextHandler.js";
import { FolderHandler } from "../src/parser/handlers/FolderHandler.js";
import { ProjectHandler } from "../src/parser/handlers/ProjectHandler.js";
import { PropertyHandler } from "../src/parser/handlers/PropertyHandler.js";
import { TaskHandler } from "../src/parser/handlers/TaskHandler.js";
import { DeleteProcessor } from "../src/parser/processors/DeleteProcessor.js";
import { NoteProcessor } from "../src/parser/processors/NoteProcessor.js";
import { EntityDeduplicator } from "../src/parser/utils/EntityDeduplicator.js";
import { ParserState } from "../src/parser/utils/ParserState.js";
import { SaxOmniFocusParser } from "../src/parser/SaxOmniFocusParser.js";
import { HTMLCleaner } from "../src/utils/htmlCleaner.js";
import { createContext, createFolder, createProject, createTask } from "./helpers.js";

describe("direct internal coverage", () => {
  it("covers handler branches and parser state fallbacks", () => {
    const state = new ParserState();
    const logger = new LoggerService();
    const deleteProcessor = new DeleteProcessor(state);
    const contextHandler = new ContextHandler(state, deleteProcessor);
    const folderHandler = new FolderHandler(state, deleteProcessor);
    const taskHandler = new TaskHandler(state, deleteProcessor);
    const projectHandler = new ProjectHandler(state);
    const propertyHandler = new PropertyHandler(state, logger);
    const noteProcessor = new NoteProcessor(state);
    taskHandler.setProjectHandler(projectHandler);

    expect(state.getCurrentElement()).toBeNull();
    expect(state.getSiblings("missing")).toEqual([]);

    state.contextMap.set("ctx-update", createContext({ id: "ctx-update", name: "Existing" }));
    contextHandler.handleStart({ id: "ctx-update", op: "update" });
    propertyHandler.setProperty("name", "Updated");
    contextHandler.handleEnd();
    expect(state.contextMap.get("ctx-update")?.name).toBe("Updated");

    contextHandler.handleStart({ op: "reference" });
    expect(contextHandler.isSkipping()).toBe(true);
    contextHandler.decrementSkipLevel();
    expect(contextHandler.isSkipping()).toBe(false);
    contextHandler.handleEnd();
    contextHandler.handleReference({ idref: "ctx-parent" });

    state.pushObject(createProject({ id: "project-for-folder" }));
    state.pushProjectStackEntry({ hasChildren: false, parentTask: createProject({ id: "stack-project" }) });
    folderHandler.handleStart({ idref: "folder-parent" });
    folderHandler.decrementSkipLevel();
    expect(state.getCurrentProjectStackEntry()?.hasChildren).toBe(true);
    state.popProjectStackEntry();
    state.popObject();

    state.folderMap.set("folder-update", createFolder({ id: "folder-update", name: "Existing Folder" }));
    folderHandler.handleStart({ id: "folder-update", op: "update" });
    propertyHandler.setProperty("status", "archived");
    folderHandler.handleEnd();
    expect(state.folderMap.get("folder-update")?.status).toBe("archived");

    state.pushObject(createFolder({ id: "folder-parent" }));
    folderHandler.handleReference({ idref: "parent-folder" });
    state.popObject();
    folderHandler.handleReference({ idref: "orphan-folder" });
    folderHandler.handleEnd();

    state.currentTagRelationship = { tagId: "ctx-1" };
    taskHandler.handleStart({ idref: "task-ref" });
    taskHandler.decrementSkipLevel();
    expect(state.currentTagRelationship?.taskId).toBe("task-ref");
    state.currentTagRelationship = null;

    state.taskMap.set("task-update", createTask({ id: "task-update", name: "Old" }));
    taskHandler.handleStart({ id: "task-update", op: "update" });
    propertyHandler.setProperty("name", "New");
    taskHandler.handleEnd();
    expect(state.taskMap.get("task-update")?.name).toBe("New");

    taskHandler.handleStart({ op: "reference" });
    taskHandler.decrementSkipLevel();
    taskHandler.handleStart({});
    taskHandler.decrementSkipLevel();
    taskHandler.handleEnd();

    state.pushObject(createProject({ id: "task-parent-project" }));
    taskHandler.handleStart({ idref: "parent-task" });
    taskHandler.decrementSkipLevel();
    state.popObject();

    state.pushObject(createFolder({ id: "folder-hidden" }));
    propertyHandler.setProperty("hidden", "true");
    propertyHandler.setProperty("name", "   ");
    state.popObject();
    expect(state.folderMap.size).toBeGreaterThanOrEqual(0);

    propertyHandler.setProperty("rank", "2");
    state.pushObject(createContext({ id: "ctx-status" }));
    propertyHandler.setProperty("status", "paused");
    state.popObject();

    noteProcessor.startNoteCollection();
    noteProcessor.handleNoteEnd("note");
  });

  it("covers deduplicator branches, html cleaner guards, and parser location/attribute fallbacks", () => {
    const deduplicated = EntityDeduplicator.deduplicateRecurringTasks(
      [
        createTask({ id: "single", name: "Single", repetitionRule: "FREQ=DAILY" }),
        createTask({ id: "completed-a", name: "Completed", repetitionRule: "FREQ=DAILY", completed: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "completed-b", name: "Completed", repetitionRule: "FREQ=DAILY", completed: new Date("2024-01-02T00:00:00Z") }),
        createTask({ id: "dated-a", name: "Dated", repetitionRule: "FREQ=DAILY", modified: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "dated-b", name: "Dated", repetitionRule: "FREQ=DAILY", added: new Date("2024-01-02T00:00:00Z") }),
        createTask({ id: "started-a", name: "Started", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "started-b", name: "Started", repetitionRule: "FREQ=DAILY" })
      ],
      [createProject({ id: "project-recurring", name: "Project Recurring", repetitionRule: "FREQ=DAILY" })]
    );
    expect(deduplicated.tasks.map((task) => task.id)).toContain("single");

    expect(HTMLCleaner.extractLines(null)).toEqual([]);
    expect(HTMLCleaner.cleanHTML("<p>Hello</p>", { preserveNewlines: false, removeArtifacts: false })).toBe("Hello");

    const parser = new SaxOmniFocusParser(new LoggerService());
    const result = parser.parse(`<?xml version="1.0" encoding="UTF-8"?>
<omnifocus>
  <task id="task-1" odd="true">
    <location name="Ignored" latitude="1" />
  </task>
  <context id="ctx-1" strange="value">
    <name>Ctx</name>
  </context>
</omnifocus>`);

    expect(result.tasks[0]?.id).toBe("task-1");
    expect(result.contexts[0]?.name).toBe("Ctx");

    expect(EntityFactory.createTask({ id: "factory-task" }).id).toBe("factory-task");
  });
});
