import type { BaseTask, Context, Project, Task } from "../types.js";
import { isDroppedOrCanceled, isProjectStatusActive } from "./availabilityFilter.js";

export interface RemainingContext {
  contextsMap: Map<string, Context>;
  projectsMap: Map<string, Project>;
  tasksMap: Map<string, Task>;
  tagsByTask: Map<string, string[]>;
}

export function isTaskRemaining(task: BaseTask, ctx: RemainingContext, visitedIds: Set<string> = new Set()): boolean {
  if (task.completed || isDroppedOrCanceled(task)) {
    return false;
  }

  if (task.type === "project" && !isProjectStatusActive(task.project.status)) {
    return false;
  }

  if (task.contextId) {
    const context = ctx.contextsMap.get(task.contextId);
    if (context?.status === "dropped") {
      return false;
    }
  }

  for (const tagId of ctx.tagsByTask.get(task.id) ?? []) {
    const tag = ctx.contextsMap.get(tagId);
    if (tag?.status === "dropped") {
      return false;
    }
  }

  if (!task.containerId || visitedIds.has(task.containerId)) {
    return true;
  }

  const nextVisited = new Set(visitedIds);
  nextVisited.add(task.containerId);

  const parentProject = ctx.projectsMap.get(task.containerId);
  if (parentProject) {
    if (isDroppedOrCanceled(parentProject) || !isProjectStatusActive(parentProject.project.status)) {
      return false;
    }
    if (!isTaskRemaining(parentProject, ctx, nextVisited)) {
      return false;
    }
  }

  const parentTask = ctx.tasksMap.get(task.containerId);
  if (parentTask && !isTaskRemaining(parentTask, ctx, nextVisited)) {
    return false;
  }

  return true;
}

