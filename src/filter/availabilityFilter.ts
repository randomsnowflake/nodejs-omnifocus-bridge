import type { BaseTask, Context, Project, Task } from "../types.js";

export interface AvailabilityContext {
  contextsMap: Map<string, Context>;
  projectsMap: Map<string, Project>;
  tasksMap: Map<string, Task>;
  tasksByContainer: Map<string, BaseTask[]>;
  tagsByTask: Map<string, string[]>;
}

export function evaluateTaskAvailability(
  task: BaseTask,
  now: Date,
  visitedIds: Set<string>,
  ctx: AvailabilityContext
): BaseTask["availabilityStatus"] {
  if (visitedIds.has(task.id)) {
    return "parent_blocked";
  }
  visitedIds.add(task.id);

  if (task.hidden) {
    return "hidden";
  }
  if (isDroppedOrCanceled(task)) {
    return "unavailable";
  }
  if (task.completed) {
    return "unavailable";
  }
  if (!isProjectOrTaskActive(task)) {
    return "project_inactive";
  }

  const contextBlocker = getContextBlocker(task, ctx);
  if (contextBlocker) {
    return contextBlocker;
  }

  if (isDeferred(task, now)) {
    return "deferred";
  }
  if (!isParentAvailable(task, now, visitedIds, ctx)) {
    return "parent_blocked";
  }
  if (!isFirstAvailableInSequence(task, now, visitedIds, ctx)) {
    if (task.containerId) {
      const parentProject = ctx.projectsMap.get(task.containerId);
      if (parentProject && isProjectSequential(parentProject)) {
        return "blocked_by_project";
      }
    }
    return "parent_blocked";
  }
  if (!hasAvailableChildren(task, now, visitedIds, ctx)) {
    return "child_blocked";
  }

  return "available";
}

export function getContextBlocker(
  task: BaseTask,
  ctx: AvailabilityContext
): "blocked_by_context" | "blocked_by_tag" | null {
  if (task.contextId) {
    const context = ctx.contextsMap.get(task.contextId);
    if (context && !isContextActive(context, ctx)) {
      return "blocked_by_context";
    }
  }

  for (const tagId of ctx.tagsByTask.get(task.id) ?? []) {
    const tag = ctx.contextsMap.get(tagId);
    if (tag && !isContextActive(tag, ctx)) {
      return "blocked_by_tag";
    }
  }

  return null;
}

export function isDeferred(task: BaseTask, now: Date): boolean {
  if (!task.start) {
    return false;
  }
  return task.start.toISOString().slice(0, 16) > now.toISOString().slice(0, 16);
}

export function isProjectStatusActive(status: string | null | undefined): boolean {
  if (!status) {
    return true;
  }
  return !["dropped", "done", "inactive", "on-hold", "onhold", "completed", "paused", "cancelled", "canceled"].includes(
    status.toLowerCase()
  );
}

export function isContextActive(context: Context, ctx: AvailabilityContext): boolean {
  if (context.status === "dropped" || context.status === "paused" || context.prohibitsNextAction) {
    return false;
  }

  if (context.parentContextId) {
    const parentContext = ctx.contextsMap.get(context.parentContextId);
    if (parentContext && !isContextActive(parentContext, ctx)) {
      return false;
    }
  }

  return true;
}

export function isDroppedOrCanceled(item: BaseTask): boolean {
  if (item.type === "project") {
    const status = item.project.status?.toLowerCase();
    return status === "dropped" || status === "cancelled" || status === "canceled";
  }
  return Boolean(item.completedByChildren);
}

function isProjectOrTaskActive(task: BaseTask): boolean {
  return task.type === "project" ? isProjectStatusActive(task.project.status) : true;
}

function isParentAvailable(task: BaseTask, now: Date, visitedIds: Set<string>, ctx: AvailabilityContext): boolean {
  if (!task.containerId) {
    return true;
  }

  const parentProject = ctx.projectsMap.get(task.containerId);
  if (parentProject) {
    if (!isProjectStatusActive(parentProject.project.status) || isDeferred(parentProject, now)) {
      return false;
    }

    if (parentProject.containerId) {
      const parentVisited = new Set(visitedIds);
      parentVisited.delete(task.id);
      const status = evaluateTaskAvailability(parentProject, now, parentVisited, ctx);
      if (status !== "available" && status !== "child_blocked") {
        return false;
      }
    }
    return true;
  }

  const parentTask = ctx.tasksMap.get(task.containerId);
  if (parentTask) {
    if (visitedIds.has(parentTask.id) || parentTask.completed || isDroppedOrCanceled(parentTask) || isDeferred(parentTask, now)) {
      return false;
    }

    if (getContextBlocker(parentTask, ctx)) {
      return false;
    }

    if (parentTask.containerId) {
      const parentVisited = new Set(visitedIds);
      parentVisited.add(parentTask.id);
      if (!isParentAvailable(parentTask, now, parentVisited, ctx)) {
        return false;
      }
    }
  }

  return true;
}

function isFirstAvailableInSequence(task: BaseTask, now: Date, visitedIds: Set<string>, ctx: AvailabilityContext): boolean {
  if (!task.containerId) {
    return true;
  }

  const parentProject = ctx.projectsMap.get(task.containerId);
  if (!parentProject || !isProjectSequential(parentProject)) {
    return true;
  }

  const siblings = sortTasksByOrder(ctx.tasksByContainer.get(task.containerId) ?? []);
  for (const sibling of siblings) {
    if (sibling.completed || isDeferred(sibling, now)) {
      continue;
    }

    const children = ctx.tasksByContainer.get(sibling.id);
    if (children?.length) {
      if (!hasAvailableDescendant(sibling.id, now, new Set(visitedIds), ctx)) {
        continue;
      }
    }

    return sibling.id === task.id;
  }

  return false;
}

function hasAvailableChildren(task: BaseTask, now: Date, visitedIds: Set<string>, ctx: AvailabilityContext): boolean {
  const children = ctx.tasksByContainer.get(task.id);
  if (!children || children.length === 0) {
    return true;
  }
  return hasAvailableDescendant(task.id, now, new Set(visitedIds), ctx);
}

function hasAvailableDescendant(containerId: string, now: Date, visitedIds: Set<string>, ctx: AvailabilityContext): boolean {
  const children = ctx.tasksByContainer.get(containerId);
  if (!children?.length) {
    return false;
  }

  for (const child of children) {
    if (visitedIds.has(child.id) || child.completed || isDroppedOrCanceled(child) || !isProjectOrTaskActive(child)) {
      continue;
    }
    if (getContextBlocker(child, ctx) || isDeferred(child, now) || !isFirstAvailableInSequence(child, now, visitedIds, ctx)) {
      continue;
    }

    const nextVisited = new Set(visitedIds);
    nextVisited.add(child.id);

    const grandChildren = ctx.tasksByContainer.get(child.id);
    if (!grandChildren?.length || hasAvailableDescendant(child.id, now, nextVisited, ctx)) {
      return true;
    }
  }

  return false;
}

function isProjectSequential(project: Project): boolean {
  return getProjectType(project) === "sequential";
}

function getProjectType(project: Project): "actionlist" | "parallel" | "sequential" | null {
  if (project.project.singleton) {
    return "actionlist";
  }
  if (project.order === "parallel") {
    return "parallel";
  }
  if (project.order === "sequential") {
    return "sequential";
  }
  return null;
}

function sortTasksByOrder(tasks: BaseTask[]): BaseTask[] {
  return [...tasks].sort((a, b) => {
    if (a.order && b.order) {
      return a.order.localeCompare(b.order);
    }
    if (a.order) {
      return -1;
    }
    if (b.order) {
      return 1;
    }
    if (a.rank === null && b.rank === null) {
      return 0;
    }
    if (a.rank === null) {
      return 1;
    }
    if (b.rank === null) {
      return -1;
    }
    return a.rank - b.rank;
  });
}
