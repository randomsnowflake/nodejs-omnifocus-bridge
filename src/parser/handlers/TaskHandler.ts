import type { BaseTask } from "../../types.js";
import { EntityFactory, type EntityAttributes } from "../EntityFactory.js";
import type { DeleteProcessor } from "../processors/DeleteProcessor.js";
import type { ProjectHandler } from "./ProjectHandler.js";
import type { ParserState } from "../utils/ParserState.js";

export class TaskHandler {
  private projectHandler: ProjectHandler | null = null;

  constructor(
    private readonly state: ParserState,
    private readonly deleteProcessor: DeleteProcessor
  ) {}

  setProjectHandler(projectHandler: ProjectHandler): void {
    this.projectHandler = projectHandler;
  }

  handleStart(attrs: Record<string, string>): void {
    if (this.state.currentTagRelationship && attrs.idref) {
      this.state.currentTagRelationship.taskId = attrs.idref;
      this.state.skipTaskLevel += 1;
      return;
    }

    if (attrs.op === "delete" && attrs.id) {
      this.deleteProcessor.deleteTask(attrs.id);
      this.state.skipTaskLevel += 1;
      return;
    }

    if (attrs.op === "update" && attrs.id) {
      const task = this.state.taskMap.get(attrs.id) ?? EntityFactory.createTask(attrs as EntityAttributes);
      this.state.pushObject(task);
      this.state.pushElement("task");
      this.notifyProjectOfChild();
      return;
    }

    if (attrs.op === "reference") {
      this.state.skipTaskLevel += 1;
      return;
    }

    if (!attrs.id && attrs.idref) {
      this.handleReference(attrs);
      this.state.skipTaskLevel += 1;
      return;
    }

    if (attrs.id) {
      const task = EntityFactory.createTask(attrs as EntityAttributes);
      this.state.pushObject(task);
      this.state.pushElement("task");
      this.notifyProjectOfChild();
      return;
    }

    this.state.skipTaskLevel += 1;
  }

  handleEnd(): void {
    if (this.state.getCurrentElement() !== "task") {
      return;
    }

    const task = this.state.popObject() as BaseTask | undefined;
    this.state.popElement();
    if (task && !this.deleteProcessor.isTaskDeleted(task.id)) {
      if (task.isProject) {
        task.type = "project";
      }
      this.state.taskMap.set(task.id, task);
    }
  }

  handleReference(attrs: Record<string, string>): void {
    const parent = this.state.getCurrentParent();
    if (parent && (parent.type === "task" || parent.type === "project")) {
      parent.containerId = attrs.idref ?? null;
    }
  }

  isSkipping(): boolean {
    return this.state.skipTaskLevel > 0;
  }

  decrementSkipLevel(): void {
    if (this.state.skipTaskLevel > 0) {
      this.state.skipTaskLevel -= 1;
    }
  }

  private notifyProjectOfChild(): void {
    if (this.projectHandler?.isInProject()) {
      this.projectHandler.markHasChildren();
    }
  }
}

