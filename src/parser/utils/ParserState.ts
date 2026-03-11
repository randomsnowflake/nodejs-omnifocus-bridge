import type { BaseTask, Context, Folder, Project, TagRelationship, Task } from "../../types.js";
import type { ProjectStackEntry } from "../types.js";

function hasMeaningfulTaskPayload(task: BaseTask): boolean {
  if (task.name?.trim()) {
    return true;
  }

  if (task.note?.trim()) {
    return true;
  }

  if (task.modified) {
    return true;
  }

  if (
    task.flagged ||
    task.hidden ||
    task.completedByChildren ||
    task.catchUpAutomatically ||
    task.inbox ||
    task.order ||
    task.start ||
    task.due ||
    task.completed ||
    task.repeat ||
    task.repetitionRule ||
    task.repetitionMethod ||
    task.containerId ||
    task.contextId ||
    task.estimatedMinutes !== null ||
    task.nextCloneIdentifier ||
    task.dueDateAlarmPolicy ||
    task.deferDateAlarmPolicy ||
    task.latestTimeToStartAlarmPolicy ||
    task.plannedDateAlarmPolicy ||
    task.repetitionScheduleType ||
    task.repetitionAnchorDate ||
    task.planned
  ) {
    return true;
  }

  return Boolean(
    task.project.singleton ||
      task.project.reviewInterval ||
      task.project.lastReview ||
      task.project.status ||
      task.project.nextReview
  );
}

export class ParserState {
  contexts: Context[] = [];
  folders: Folder[] = [];
  projects: Project[] = [];
  tasks: Task[] = [];
  tagRelationships: TagRelationship[] = [];

  objectStack: Array<Context | Folder | BaseTask> = [];
  elementStack: string[] = [];
  projectStack: ProjectStackEntry[] = [];

  contextMap = new Map<string, Context>();
  folderMap = new Map<string, Folder>();
  taskMap = new Map<string, BaseTask>();

  deletedContextIds = new Set<string>();
  deletedFolderIds = new Set<string>();
  deletedTaskIds = new Set<string>();
  inboxTaskIds = new Set<string>();

  skipTaskLevel = 0;
  skipFolderLevel = 0;
  skipContextLevel = 0;

  collectingNote = false;
  noteBuffer = "";
  currentTagRelationship: Partial<TagRelationship> | null = null;
  currentText = "";
  currentParentTag: string | null = null;
  siblingElements = new Map<string, Set<string>>();

  getCurrentParent(): Context | Folder | BaseTask | null {
    return this.objectStack.at(-1) ?? null;
  }

  pushObject(obj: Context | Folder | BaseTask): void {
    this.objectStack.push(obj);
  }

  popObject(): Context | Folder | BaseTask | undefined {
    return this.objectStack.pop();
  }

  pushElement(element: string): void {
    this.elementStack.push(element);
  }

  popElement(): string | undefined {
    return this.elementStack.pop();
  }

  getCurrentElement(): string | null {
    return this.elementStack.at(-1) ?? null;
  }

  pushProjectStackEntry(entry: ProjectStackEntry): void {
    this.projectStack.push(entry);
  }

  popProjectStackEntry(): ProjectStackEntry | undefined {
    return this.projectStack.pop();
  }

  getCurrentProjectStackEntry(): ProjectStackEntry | null {
    return this.projectStack.at(-1) ?? null;
  }

  clearEntities(): void {
    this.contexts = [];
    this.folders = [];
    this.projects = [];
    this.tasks = [];
    this.tagRelationships = [];
    this.contextMap.clear();
    this.folderMap.clear();
    this.taskMap.clear();
    this.deletedContextIds.clear();
    this.deletedFolderIds.clear();
    this.deletedTaskIds.clear();
    this.inboxTaskIds.clear();
    this.siblingElements.clear();
  }

  extractEntities(): void {
    this.contexts = Array.from(this.contextMap.values());
    this.folders = Array.from(this.folderMap.values());
    this.projects = [];
    this.tasks = [];

    for (const task of this.taskMap.values()) {
      if (!hasMeaningfulTaskPayload(task)) {
        continue;
      }

      if (task.type === "project") {
        this.projects.push(task as Project);
      } else {
        this.tasks.push(task as Task);
      }
    }
  }

  applyInboxOverrides(): void {
    if (this.inboxTaskIds.size === 0) {
      return;
    }

    for (const task of this.tasks) {
      if (this.inboxTaskIds.has(task.id)) {
        task.inbox = true;
        task.containerId = null;
      }
    }

    for (const project of this.projects) {
      if (this.inboxTaskIds.has(project.id)) {
        project.inbox = true;
        project.containerId = null;
      }
    }
  }

  trackSiblingElement(parentTag: string, childTag: string): void {
    const siblings = this.siblingElements.get(parentTag) ?? new Set<string>();
    siblings.add(childTag);
    this.siblingElements.set(parentTag, siblings);
  }

  getSiblings(parentTag: string): string[] {
    return Array.from(this.siblingElements.get(parentTag) ?? []);
  }
}
