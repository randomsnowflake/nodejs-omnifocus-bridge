import type { BaseTask, Context } from "../types.js";
import { getContextBlocker, isContextActive, isDeferred, isDroppedOrCanceled, type AvailabilityContext } from "./availabilityFilter.js";

export function getItemStatus(
  item: BaseTask,
  ctx: AvailabilityContext
): "completed" | "dropped" | "paused" | "deferred" | "available" {
  if (item.completed) {
    return "completed";
  }

  if (isDroppedOrCanceled(item)) {
    return "dropped";
  }

  if (item.type === "project") {
    const status = item.project.status?.toLowerCase();
    if (status === "paused" || status === "on-hold" || status === "onhold" || status === "inactive") {
      return "paused";
    }
  }

  const contextBlocker = getContextBlocker(item, ctx);
  if (contextBlocker) {
    const blockingContext = findBlockingContext(item, ctx);
    if (blockingContext?.status === "paused") {
      return "paused";
    }
    return "paused";
  }

  if (item.containerId) {
    const parentProject = ctx.projectsMap.get(item.containerId);
    const status = parentProject?.project.status?.toLowerCase();
    if (status === "paused" || status === "on-hold" || status === "onhold" || status === "inactive") {
      return "paused";
    }
  }

  return isDeferred(item, new Date()) ? "deferred" : "available";
}

function findBlockingContext(task: BaseTask, ctx: AvailabilityContext): Context | null {
  if (task.contextId) {
    const context = ctx.contextsMap.get(task.contextId);
    if (context && !isContextActive(context, ctx)) {
      return context;
    }
  }

  for (const tagId of ctx.tagsByTask.get(task.id) ?? []) {
    const tag = ctx.contextsMap.get(tagId);
    if (tag && !isContextActive(tag, ctx)) {
      return tag;
    }
  }

  return null;
}

