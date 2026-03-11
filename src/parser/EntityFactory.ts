import type { BaseTask, Context, Folder } from "../types.js";

export interface EntityAttributes {
  id: string;
  idref?: string;
  [key: string]: string | undefined;
}

export class EntityFactory {
  static createContext(attrs: EntityAttributes): Context {
    return {
      type: "context",
      id: attrs.id,
      name: null,
      added: null,
      modified: null,
      rank: null,
      parentContextId: null,
      location: null,
      hidden: false,
      prohibitsNextAction: false,
      tasksUserOrdered: false,
      childrenAreMutuallyExclusive: false,
      status: null
    };
  }

  static createFolder(attrs: EntityAttributes): Folder {
    return {
      type: "folder",
      id: attrs.id,
      name: null,
      added: null,
      modified: null,
      rank: null,
      parentFolderId: null,
      hidden: false,
      hiddenAt: null
    };
  }

  static createTask(attrs: EntityAttributes): BaseTask {
    return {
      type: "task",
      id: attrs.id,
      name: null,
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
      inbox: false
    };
  }
}

