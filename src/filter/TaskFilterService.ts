import type { BaseTask, Context, OmniFocusDocument, Project, TagRelationship, Task, TaskStatusFilter } from "../types.js";
import { evaluateTaskAvailability, isDroppedOrCanceled, type AvailabilityContext } from "./availabilityFilter.js";
import { deduplicateRecurringTasks } from "./deferralFilter.js";
import { isTaskRemaining, type RemainingContext } from "./remainingFilter.js";
import { getItemStatus as calculateItemStatus } from "./statusFilter.js";

export class TaskFilterService {
  private readonly contextsMap = new Map<string, Context>();
  private readonly projectsMap = new Map<string, Project>();
  private readonly tasksMap = new Map<string, Task>();
  private readonly tasksByContainer = new Map<string, BaseTask[]>();
  private readonly tagsByTask = new Map<string, string[]>();

  setDocument(doc: OmniFocusDocument): void {
    this.contextsMap.clear();
    this.projectsMap.clear();
    this.tasksMap.clear();
    this.tasksByContainer.clear();
    this.tagsByTask.clear();

    for (const context of doc.contexts) {
      this.contextsMap.set(context.id, context);
    }

    for (const project of doc.projects) {
      this.projectsMap.set(project.id, project);
      this.addToContainerMap(project);
    }

    for (const task of doc.tasks) {
      this.tasksMap.set(task.id, task);
      this.addToContainerMap(task);
    }

    for (const relationship of doc.tagRelationships) {
      const tags = this.tagsByTask.get(relationship.taskId) ?? [];
      tags.push(relationship.tagId);
      this.tagsByTask.set(relationship.taskId, tags);
    }
  }

  filterTasks(tasks: Task[], mode: TaskStatusFilter): Task[] {
    if (mode === "available") {
      const now = new Date();
      const evaluated = tasks.map((task) => {
        const availability = evaluateTaskAvailability(task, now, new Set(), this.getAvailabilityContext());
        task.availabilityStatus = availability === "unavailable" ? undefined : availability;
        return { task, availability };
      });

      return deduplicateRecurringTasks(
        evaluated.filter((entry) => entry.availability === "available").map((entry) => entry.task)
      );
    }

    const now = new Date();
    for (const task of tasks) {
      const availability = evaluateTaskAvailability(task, now, new Set(), this.getAvailabilityContext());
      task.availabilityStatus = availability === "unavailable" ? undefined : availability;
    }

    return this.filterItems(tasks, mode);
  }

  filterProjects(projects: Project[], mode: TaskStatusFilter): Project[] {
    return this.filterItems(projects, mode);
  }

  isTaskAvailable(task: BaseTask, now = new Date(), visitedIds: Set<string> = new Set()): boolean {
    return evaluateTaskAvailability(task, now, visitedIds, this.getAvailabilityContext()) === "available";
  }

  isTaskRemaining(task: BaseTask, visitedIds: Set<string> = new Set()): boolean {
    return isTaskRemaining(task, this.getRemainingContext(), visitedIds);
  }

  getTagsForTask(taskId: string): string[] {
    return this.tagsByTask.get(taskId) ?? [];
  }

  getItemStatus(item: BaseTask): "completed" | "dropped" | "paused" | "deferred" | "available" {
    return calculateItemStatus(item, this.getAvailabilityContext());
  }

  private addToContainerMap(item: BaseTask): void {
    if (!item.containerId) {
      return;
    }
    const items = this.tasksByContainer.get(item.containerId) ?? [];
    items.push(item);
    this.tasksByContainer.set(item.containerId, items);
  }

  private filterItems<T extends BaseTask>(items: T[], mode: TaskStatusFilter): T[] {
    switch (mode) {
      case "all":
        return items;
      case "available":
        return items.filter((item) => this.isTaskAvailable(item));
      case "remaining":
        return items.filter((item) => this.isTaskRemaining(item));
      case "completed":
        return items.filter((item) => item.completed !== null);
      case "dropped":
        return items.filter((item) => isDroppedOrCanceled(item));
    }
  }

  private getAvailabilityContext(): AvailabilityContext {
    return {
      contextsMap: this.contextsMap,
      projectsMap: this.projectsMap,
      tasksMap: this.tasksMap,
      tasksByContainer: this.tasksByContainer,
      tagsByTask: this.tagsByTask
    };
  }

  private getRemainingContext(): RemainingContext {
    return {
      contextsMap: this.contextsMap,
      projectsMap: this.projectsMap,
      tasksMap: this.tasksMap,
      tagsByTask: this.tagsByTask
    };
  }
}

