import type { BaseTask, Context, Project } from "../types.js";

function formatDate(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }

  return `${mins}m`;
}

export class OmniFocusFormatter {
  static getTaskAttributes(task: BaseTask): string[] {
    const attributes: string[] = [];
    const dateFields: Array<[keyof BaseTask, string]> = [
      ["start", "defer"],
      ["due", "due"],
      ["planned", "plan"],
      ["completed", "completed"]
    ];

    for (const [field, label] of dateFields) {
      const value = task[field] as Date | null | undefined;
      const formatted = formatDate(value);
      if (formatted) {
        attributes.push(`${label}:${formatted}`);
      }
    }

    if (task.repetitionRule) {
      attributes.push(`repeat:${task.repetitionRule}`);
    }

    if (task.estimatedMinutes) {
      attributes.push(`est:${formatDuration(task.estimatedMinutes)}`);
    }

    if (task.flagged) {
      attributes.push("flagged");
    }

    switch (task.availabilityStatus) {
      case "blocked_by_project":
        attributes.push("blocked:project");
        break;
      case "blocked_by_context":
        attributes.push("blocked:context");
        break;
      case "blocked_by_tag":
        attributes.push("blocked:tag");
        break;
      case "parent_blocked":
        attributes.push("blocked:parent");
        break;
      case "child_blocked":
        attributes.push("blocked:child");
        break;
      case "project_inactive":
        attributes.push("blocked:project-inactive");
        break;
      case "deferred":
        attributes.push("deferred");
        break;
      default:
        break;
    }

    return attributes;
  }

  static getProjectType(project: Project): "actionlist" | "parallel" | "sequential" | null {
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

  static getProjectAttributes(project: Project, contextsMap: Map<string, Context>): string[] {
    const attributes: string[] = [];
    if (project.contextId) {
      const context = contextsMap.get(project.contextId);
      if (context?.name) {
        attributes.push(`@${context.name}`);
      }
    }

    const projectType = this.getProjectType(project);
    if (projectType) {
      attributes.push(`type:${projectType}`);
    }

    if (project.project.status && project.project.status !== "active") {
      attributes.push(`[${project.project.status}]`);
    }

    if (project.project.reviewInterval) {
      attributes.push(`review:${project.project.reviewInterval}`);
    }

    attributes.push(...this.getTaskAttributes(project));
    return attributes;
  }

  static getContextAttributes(context: Context): string[] {
    if (context.status === "dropped") {
      return ["dropped"];
    }
    if (context.status === "paused" || context.prohibitsNextAction) {
      return ["paused"];
    }
    return [];
  }
}

