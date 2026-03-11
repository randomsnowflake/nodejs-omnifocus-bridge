import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { renderTaskChart } from "../src/render.js";
import { createContextTree, createInboxTree, createProjectTree, createSnapshot } from "../src/snapshot.js";
import { createContext, createDocument, createFolder, createProject, createTagRelationship, createTask } from "./helpers.js";

describe("filter services and rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  it("covers availability, remaining, status, task filters, snapshots, and renderer", () => {
    const activeContext = createContext({ id: "ctx-active", name: "Work" });
    const pausedContext = createContext({ id: "ctx-paused", status: "paused" });
    const droppedContext = createContext({ id: "ctx-dropped", status: "dropped" });
    const waitingContext = createContext({ id: "ctx-waiting", prohibitsNextAction: true });
    const folder = createFolder({ id: "folder-1", name: "Area", rank: 1 });
    const project = createProject({
      id: "project-1",
      name: "Project A",
      containerId: "folder-1",
      rank: 1,
      project: { singleton: false, reviewInterval: "@1w", lastReview: null, status: "active", nextReview: null }
    });
    const sequential = createProject({
      id: "project-2",
      name: "Sequential",
      order: "sequential",
      project: { singleton: false, reviewInterval: null, lastReview: null, status: "active", nextReview: null }
    });
    const task1 = createTask({ id: "task-1", name: "First", containerId: "project-2", rank: 1, contextId: "ctx-active" });
    const task2 = createTask({ id: "task-2", name: "Second", containerId: "project-2", rank: 2, contextId: "ctx-active" });
    const inboxTask = createTask({ id: "task-3", name: "Inbox", inbox: true, note: "<p>Inbox note</p>" });
    const deferredTask = createTask({ id: "task-4", name: "Deferred", start: new Date("2024-01-20T00:00:00Z") });
    const completedTask = createTask({ id: "task-5", name: "Completed", completed: new Date("2024-01-10T00:00:00Z") });
    const droppedTask = createTask({ id: "task-6", name: "Dropped", completedByChildren: true });
    const blockedByPausedContext = createTask({ id: "task-7", name: "Paused Context", contextId: "ctx-paused" });
    const blockedByTag = createTask({ id: "task-8", name: "Tag Blocked" });
    const hiddenTask = createTask({ id: "task-9", name: "Hidden", hidden: true });
    const childBlockedParent = createTask({ id: "task-10", name: "Parent Task" });
    const childBlockedChild = createTask({ id: "task-11", name: "Blocked Child", containerId: "task-10", start: new Date("2024-01-20T00:00:00Z") });
    const droppedProjectTask = createTask({ id: "task-12", name: "Dropped Project Task", containerId: "project-3" });
    const droppedProject = createProject({
      id: "project-3",
      name: "Dropped Project",
      project: { singleton: false, reviewInterval: null, lastReview: null, status: "dropped", nextReview: null }
    });

    const document = createDocument({
      contexts: [activeContext, pausedContext, droppedContext, waitingContext],
      folders: [folder],
      projects: [project, sequential, droppedProject],
      tasks: [
        task1,
        task2,
        inboxTask,
        deferredTask,
        completedTask,
        droppedTask,
        blockedByPausedContext,
        blockedByTag,
        hiddenTask,
        childBlockedParent,
        childBlockedChild,
        droppedProjectTask
      ],
      tagRelationships: [createTagRelationship({ taskId: "task-8", tagId: "ctx-waiting" })]
    });

    const service = new TaskFilterService();
    service.setDocument(document);

    expect(isProjectStatusActive("paused")).toBe(false);
    expect(isContextActive(activeContext, {
      contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
      projectsMap: new Map(),
      tasksMap: new Map(),
      tasksByContainer: new Map(),
      tagsByTask: new Map()
    })).toBe(true);
    expect(isDeferred(deferredTask, new Date("2024-01-15T12:00:00Z"))).toBe(true);
    expect(isDeferred(createTask({ start: new Date("2024-01-15T12:00:59Z") }), new Date("2024-01-15T12:00:01Z"))).toBe(true);
    expect(isDroppedOrCanceled(droppedTask)).toBe(true);
    expect(getContextBlocker(blockedByTag, {
      contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
      projectsMap: new Map(),
      tasksMap: new Map(),
      tasksByContainer: new Map(),
      tagsByTask: new Map([["task-8", ["ctx-waiting"]]])
    })).toBe("blocked_by_tag");

    expect(service.isTaskAvailable(task1)).toBe(true);
    expect(service.isTaskAvailable(task2)).toBe(false);
    expect(service.isTaskRemaining(deferredTask)).toBe(true);
    expect(service.getTagsForTask("task-8")).toEqual(["ctx-waiting"]);
    expect(service.filterTasks(document.tasks, "available").map((task) => task.id)).toContain("task-1");
    expect(service.filterTasks(document.tasks, "remaining").map((task) => task.id)).toContain("task-4");
    expect(service.filterTasks(document.tasks, "completed").map((task) => task.id)).toEqual(["task-5"]);
    expect(service.filterTasks(document.tasks, "dropped").map((task) => task.id)).toContain("task-6");
    expect(service.filterProjects(document.projects, "dropped").map((projectItem) => projectItem.id)).toEqual(["project-3"]);
    expect(getItemStatus(deferredTask, {
      contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
      projectsMap: new Map(document.projects.map((projectItem) => [projectItem.id, projectItem])),
      tasksMap: new Map(document.tasks.map((task) => [task.id, task])),
      tasksByContainer: new Map(),
      tagsByTask: new Map([["task-8", ["ctx-waiting"]]])
    })).toBe("deferred");

    expect(
      evaluateTaskAvailability(childBlockedParent, new Date("2024-01-15T12:00:00Z"), new Set(), {
        contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
        projectsMap: new Map(document.projects.map((projectItem) => [projectItem.id, projectItem])),
        tasksMap: new Map(document.tasks.map((task) => [task.id, task])),
        tasksByContainer: new Map([["task-10", [childBlockedChild]]]),
        tagsByTask: new Map()
      })
    ).toBe("child_blocked");
    expect(
      evaluateTaskAvailability(
        createProject({ id: "hidden-project", name: "Hidden Project" }),
        new Date("2024-01-15T12:00:00Z"),
        new Set(),
        {
          contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
          projectsMap: new Map([["hidden-project", createProject({ id: "hidden-project", name: "Hidden Project" })]]),
          tasksMap: new Map([["hidden-child", createTask({ id: "hidden-child", containerId: "hidden-project", hidden: true })]]),
          tasksByContainer: new Map([["hidden-project", [createTask({ id: "hidden-child", containerId: "hidden-project", hidden: true })]]]),
          tagsByTask: new Map()
        }
      )
    ).toBe("child_blocked");
    expect(isTaskRemaining(droppedProjectTask, {
      contextsMap: new Map(document.contexts.map((context) => [context.id, context])),
      projectsMap: new Map(document.projects.map((projectItem) => [projectItem.id, projectItem])),
      tasksMap: new Map(document.tasks.map((task) => [task.id, task])),
      tagsByTask: new Map()
    })).toBe(false);
    expect(deduplicateRecurringTasks([
      createTask({ id: "r1", name: "Recurring", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-01T00:00:00Z") }),
      createTask({ id: "r2", name: "Recurring", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-14T00:00:00Z") }),
      createTask({ id: "r3", name: "Recurring", repetitionRule: "FREQ=DAILY", start: new Date("2024-01-20T00:00:00Z") })
    ])).toHaveLength(1);

    const snapshot = createSnapshot(document, "available");
    expect(createContextTree(snapshot).length).toBe(4);
    expect(createInboxTree(snapshot).length).toBe(1);
    expect(createProjectTree(snapshot).length).toBeGreaterThan(0);
    expect(renderTaskChart(snapshot)).toMatchInlineSnapshot(`
"OmniFocus Database Summary (available view)
==================================================
Folders: 1
Projects: 1 (of 3)
Tasks: 2 (of 12)
Inbox: 1 tasks
Tags/Contexts: 4

TAGS/CONTEXTS:
----------------------------------------
├── Work
├── Context (paused)
├── Context (dropped)
└── Context (paused)

INBOX:
----------------------------------------
└── [ ] Inbox
        - Inbox note

FOLDERS & PROJECTS:
----------------------------------------
└── [P] Sequential (type:sequential)
    └── [ ] First (@Work)"
`);
  });
});
