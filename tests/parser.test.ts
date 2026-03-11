import { describe, expect, it } from "vitest";

import { LoggerService } from "../src/logger.js";
import { EntityFactory } from "../src/parser/EntityFactory.js";
import { SaxOmniFocusParser } from "../src/parser/SaxOmniFocusParser.js";
import { ContextHandler } from "../src/parser/handlers/ContextHandler.js";
import { FolderHandler } from "../src/parser/handlers/FolderHandler.js";
import { ProjectHandler } from "../src/parser/handlers/ProjectHandler.js";
import { PropertyHandler } from "../src/parser/handlers/PropertyHandler.js";
import { TagRelationshipHandler } from "../src/parser/handlers/TagRelationshipHandler.js";
import { TaskHandler } from "../src/parser/handlers/TaskHandler.js";
import { DeleteProcessor } from "../src/parser/processors/DeleteProcessor.js";
import { NoteProcessor } from "../src/parser/processors/NoteProcessor.js";
import { EntityDeduplicator } from "../src/parser/utils/EntityDeduplicator.js";
import { ParserState } from "../src/parser/utils/ParserState.js";
import { createBaseTask, createContext, createFolder, createProject, createTask } from "./helpers.js";

describe("parser helpers", () => {
  it("covers entity factory, parser state, handlers, processors, and deduplicator", () => {
    const state = new ParserState();
    const deleteProcessor = new DeleteProcessor(state);
    const contextHandler = new ContextHandler(state, deleteProcessor);
    const folderHandler = new FolderHandler(state, deleteProcessor);
    const taskHandler = new TaskHandler(state, deleteProcessor);
    const projectHandler = new ProjectHandler(state);
    const propertyHandler = new PropertyHandler(state, new LoggerService());
    const tagRelationshipHandler = new TagRelationshipHandler(state);
    const noteProcessor = new NoteProcessor(state);

    taskHandler.setProjectHandler(projectHandler);

    const context = EntityFactory.createContext({ id: "ctx-1" });
    const folder = EntityFactory.createFolder({ id: "folder-1" });
    const task = EntityFactory.createTask({ id: "task-1" });
    expect(context.type).toBe("context");
    expect(folder.type).toBe("folder");
    expect(task.type).toBe("task");

    contextHandler.handleStart({ id: "ctx-1" });
    propertyHandler.setProperty("name", " Context  Name ");
    contextHandler.handleEnd();
    expect(state.contextMap.get("ctx-1")?.name).toBe("Context Name");

    contextHandler.handleStart({ idref: "ctx-parent" });
    contextHandler.decrementSkipLevel();
    expect(contextHandler.isSkipping()).toBe(false);

    folderHandler.handleStart({ id: "folder-1" });
    propertyHandler.setProperty("hidden", "2024-01-01T00:00:00Z");
    folderHandler.handleEnd();
    expect(state.folderMap.get("folder-1")?.hiddenAt?.toISOString()).toBe("2024-01-01T00:00:00.000Z");

    taskHandler.handleStart({ id: "parent-task" });
    projectHandler.handleStart();
    taskHandler.handleStart({ id: "child-under-parent" });
    taskHandler.handleEnd();
    projectHandler.handleEnd();
    taskHandler.handleEnd();
    expect(state.taskMap.get("parent-task")?.type).toBe("project");

    const childTask = createBaseTask({ id: "child-task", type: "task" });
    state.pushObject(childTask);
    taskHandler.handleReference({ idref: "parent-task" });
    expect(childTask.containerId).toBe("parent-task");
    state.popObject();

    taskHandler.handleStart({ id: "skip-task", op: "reference" });
    taskHandler.decrementSkipLevel();
    expect(taskHandler.isSkipping()).toBe(false);

    state.pushObject(createContext({ id: "ctx-2" }));
    propertyHandler.setProperty("prohibits-next-action", "true");
    propertyHandler.setProperty("tasks-user-ordered", "true");
    propertyHandler.setProperty("children-are-mutually-exclusive", "true");
    propertyHandler.setProperty("status", "mystery");
    state.popObject();

    state.pushObject(createTask({ id: "prop-task" }));
    propertyHandler.setProperty("flagged", "true");
    propertyHandler.setProperty("order", "parallel");
    propertyHandler.setProperty("start", "2024-01-01T00:00:00Z");
    propertyHandler.setProperty("due", "2024-01-02T00:00:00Z");
    propertyHandler.setProperty("completed", "2024-01-03T00:00:00Z");
    propertyHandler.setProperty("repeat", "daily");
    propertyHandler.setProperty("repetition-rule", "FREQ=DAILY");
    propertyHandler.setProperty("repetition-method", "fixed");
    propertyHandler.setProperty("singleton", "true");
    propertyHandler.setProperty("review-interval", "@1w");
    propertyHandler.setProperty("last-review", "2024-01-01T00:00:00Z");
    propertyHandler.setProperty("estimated-minutes", "30");
    propertyHandler.setProperty("completed-by-children", "false");
    propertyHandler.setProperty("next-clone-identifier", "clone");
    propertyHandler.setProperty("due-date-alarm-policy", "policy");
    propertyHandler.setProperty("defer-date-alarm-policy", "policy");
    propertyHandler.setProperty("latest-time-to-start-alarm-policy", "policy");
    propertyHandler.setProperty("planned-date-alarm-policy", "policy");
    propertyHandler.setProperty("repetition-schedule-type", "schedule");
    propertyHandler.setProperty("repetition-anchor-date", "2024-01-05T00:00:00Z");
    propertyHandler.setProperty("planned", "2024-01-04T00:00:00Z");
    propertyHandler.setProperty("catch-up-automatically", "true");
    propertyHandler.setProperty("inbox", "true");
    propertyHandler.setProperty("next-review", "2024-01-06T00:00:00Z");
    state.currentTagRelationship = { taskId: "prop-task", tagId: "ctx-2" };
    propertyHandler.setProperty("rank-in-task", "1");
    propertyHandler.setProperty("rank-in-tag", "2");
    state.popObject();

    noteProcessor.startNoteCollection();
    noteProcessor.appendText("Hello");
    noteProcessor.appendOpenTag("b", {});
    expect(noteProcessor.isCollecting()).toBe(true);
    state.pushObject(createTask({ id: "note-task" }));
    noteProcessor.handleNoteEnd("b");
    expect(noteProcessor.handleNoteEnd("note")).toBe(true);
    state.popObject();

    tagRelationshipHandler.handleTaskToTagStart({ id: "ctx-2" });
    taskHandler.handleStart({ idref: "prop-task" });
    taskHandler.decrementSkipLevel();
    tagRelationshipHandler.handleTaskToTagEnd();
    tagRelationshipHandler.handleInboxTask({ id: "prop-task" });
    tagRelationshipHandler.handleInboxTask({ id: "prop-task", op: "delete" });

    deleteProcessor.deleteContext("ctx-1");
    deleteProcessor.deleteFolder("folder-1");
    deleteProcessor.deleteTask("parent-task");
    expect(deleteProcessor.isContextDeleted("ctx-1")).toBe(true);
    expect(deleteProcessor.isFolderDeleted("folder-1")).toBe(true);
    expect(deleteProcessor.isTaskDeleted("parent-task")).toBe(true);

    state.pushObject(createContext({ id: "ctx-stack" }));
    state.pushElement("context");
    state.pushProjectStackEntry({ hasChildren: false, parentTask: createProject({ id: "proj-stack" }) });
    expect(state.getCurrentParent()?.id).toBe("ctx-stack");
    expect(state.getCurrentElement()).toBe("context");
    expect(state.getCurrentProjectStackEntry()?.parentTask?.id).toBe("proj-stack");
    state.trackSiblingElement("task", "name");
    expect(state.getSiblings("task")).toEqual(["name"]);
    state.popProjectStackEntry();
    state.popElement();
    state.popObject();

    state.tasks.push(createTask({ id: "inbox-task", containerId: "folder-x" }));
    state.projects.push(createProject({ id: "inbox-project", containerId: "folder-y" }));
    state.inboxTaskIds.add("inbox-task");
    state.inboxTaskIds.add("inbox-project");
    state.applyInboxOverrides();
    expect(state.tasks[0]?.containerId).toBeNull();
    expect(state.projects[0]?.containerId).toBeNull();

    state.contextMap.set("ctx-extract", createContext({ id: "ctx-extract" }));
    state.folderMap.set("folder-extract", createFolder({ id: "folder-extract" }));
    state.taskMap.set("extract-task", createTask({ id: "extract-task" }));
    state.extractEntities();
    state.clearEntities();
    expect(state.contexts).toEqual([]);

    const deduped = EntityDeduplicator.deduplicateRecurringTasks(
      [
        createTask({ id: "r1", name: "Recurring", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-01T00:00:00Z") }),
        createTask({ id: "r2", name: "Recurring", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-02T00:00:00Z") })
      ],
      []
    );
    expect(deduped.tasks).toHaveLength(1);
  });
});

describe("SaxOmniFocusParser", () => {
  it("parses updates, projects, notes, tags, inbox items, and location data", () => {
    const parser = new SaxOmniFocusParser(new LoggerService());

    const initialXml = `<?xml version="1.0" encoding="UTF-8"?>
<omnifocus>
  <context id="ctx-parent"><name>Parent</name></context>
  <context id="ctx-child"><context idref="ctx-parent"/><name>Child</name><location name="Office" latitude="1" longitude="2" radius="3" notificationFlags="4" /></context>
  <folder id="folder-parent"><name>Folder</name></folder>
  <folder id="folder-child"><folder idref="folder-parent"/><name>Subfolder</name></folder>
  <task id="project-task">
    <name>Project</name>
    <project>
      <task id="child-task">
        <name>Child</name>
        <context idref="ctx-child"/>
        <note><p>Hello <lit>world</lit></p></note>
      </task>
    </project>
  </task>
  <task-to-tag id="ctx-child">
    <task idref="child-task"/>
    <rank-in-task>1</rank-in-task>
    <rank-in-tag>2</rank-in-tag>
  </task-to-tag>
  <inbox-task idref="child-task" />
</omnifocus>`;

    const updateXml = `<?xml version="1.0" encoding="UTF-8"?>
<omnifocus>
  <folder id="folder-child" op="update"><folder/></folder>
  <task id="child-task" op="update"><name>Child Updated</name></task>
  <context id="ctx-deleted" op="delete"></context>
</omnifocus>`;

    const result = parser.parseMultiple([initialXml, updateXml]);
    expect(result.contexts.find((context) => context.id === "ctx-child")?.location?.name).toBe("Office");
    expect(result.folders.find((folder) => folder.id === "folder-child")?.parentFolderId).toBeNull();
    expect(result.projects.find((project) => project.id === "project-task")?.isProject).toBe(true);
    expect(result.tasks.find((task) => task.id === "child-task")?.name).toBe("Child Updated");
    expect(result.tasks.find((task) => task.id === "child-task")?.note).toContain("<p>");
    expect(result.tasks.find((task) => task.id === "child-task")?.inbox).toBe(true);
    expect(result.tagRelationships[0]).toEqual({
      taskId: "child-task",
      tagId: "ctx-child",
      rankInTask: 1,
      rankInTag: 2,
      added: null,
      contextId: null
    });
  });

  it("keeps recurring items distinct in the parsed document", () => {
    const parser = new SaxOmniFocusParser(new LoggerService());

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<omnifocus>
  <task id="repeat-1">
    <name>Recurring</name>
    <repetition-rule>FREQ=DAILY</repetition-rule>
    <note>first</note>
  </task>
  <task id="repeat-2">
    <name>Recurring</name>
    <repetition-rule>FREQ=DAILY</repetition-rule>
    <note>second</note>
  </task>
  <task id="repeat-3">
    <name>Recurring</name>
    <repetition-rule>FREQ=DAILY</repetition-rule>
    <completed>2024-01-01T00:00:00Z</completed>
  </task>
</omnifocus>`;

    const result = parser.parse(xml);

    expect(result.tasks.map((task) => task.id)).toEqual(["repeat-1", "repeat-2", "repeat-3"]);
    expect(result.tasks.map((task) => task.note)).toEqual(["first", "second", null]);
  });
});
