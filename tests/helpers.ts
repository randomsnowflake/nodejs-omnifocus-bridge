import type { BaseTask, Context, Folder, OmniFocusDocument, Project, TagRelationship, Task } from "../src/types.js";

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    type: "task",
    id: "task-1",
    name: "Task",
    added: null,
    modified: null,
    rank: null,
    note: null,
    flagged: false,
    order: null,
    start: null,
    due: null,
    completed: null,
    repeat: null,
    repetitionRule: null,
    repetitionMethod: null,
    containerId: null,
    contextId: null,
    isProject: false,
    project: {
      singleton: false,
      reviewInterval: null,
      lastReview: null,
      status: null,
      nextReview: null
    },
    hidden: false,
    estimatedMinutes: null,
    completedByChildren: false,
    nextCloneIdentifier: null,
    dueDateAlarmPolicy: null,
    deferDateAlarmPolicy: null,
    latestTimeToStartAlarmPolicy: null,
    plannedDateAlarmPolicy: null,
    repetitionScheduleType: null,
    repetitionAnchorDate: null,
    planned: null,
    catchUpAutomatically: false,
    inbox: false,
    ...overrides
  };
}

export function createProject(overrides: Partial<Project> = {}): Project {
  return {
    ...createTask(),
    type: "project",
    id: "project-1",
    name: "Project",
    isProject: true,
    project: {
      singleton: false,
      reviewInterval: null,
      lastReview: null,
      status: "active",
      nextReview: null
    },
    ...overrides
  };
}

export function createContext(overrides: Partial<Context> = {}): Context {
  return {
    type: "context",
    id: "context-1",
    name: "Context",
    added: null,
    modified: null,
    rank: null,
    parentContextId: null,
    location: null,
    hidden: false,
    prohibitsNextAction: false,
    tasksUserOrdered: false,
    childrenAreMutuallyExclusive: false,
    status: "active",
    ...overrides
  };
}

export function createFolder(overrides: Partial<Folder> = {}): Folder {
  return {
    type: "folder",
    id: "folder-1",
    name: "Folder",
    added: null,
    modified: null,
    rank: null,
    parentFolderId: null,
    hidden: false,
    hiddenAt: null,
    status: "active",
    ...overrides
  };
}

export function createTagRelationship(overrides: Partial<TagRelationship> = {}): TagRelationship {
  return {
    taskId: "task-1",
    tagId: "context-1",
    rankInTask: null,
    rankInTag: null,
    added: null,
    contextId: null,
    ...overrides
  };
}

export function createDocument(overrides: Partial<OmniFocusDocument> = {}): OmniFocusDocument {
  return {
    contexts: [],
    folders: [],
    projects: [],
    tasks: [],
    tagRelationships: [],
    ...overrides
  };
}

export function createBaseTask(overrides: Partial<BaseTask> = {}): BaseTask {
  return createTask(overrides);
}

