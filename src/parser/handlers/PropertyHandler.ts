import { LogLevel, LoggerService } from "../../logger.js";
import type { BaseTask, Context, Folder } from "../../types.js";
import { parseNumber } from "../../utils/number.js";
import type { ParserState } from "../utils/ParserState.js";

export class PropertyHandler {
  constructor(
    private readonly state: ParserState,
    private readonly logger: LoggerService
  ) {}

  setProperty(tagName: string, text: string): void {
    const processedText = tagName === "name" ? text.replace(/^\s+|\s+$/g, "") : text.trim();

    if (tagName === "rank-in-task" && this.state.currentTagRelationship) {
      this.state.currentTagRelationship.rankInTask = parseNumber(processedText, 10);
      return;
    }

    if (tagName === "rank-in-tag" && this.state.currentTagRelationship) {
      this.state.currentTagRelationship.rankInTag = parseNumber(processedText, 10);
      return;
    }

    const parentObject = this.state.getCurrentParent();
    if (!parentObject) {
      return;
    }

    if (!processedText && tagName !== "name") {
      return;
    }

    const taskObject = this.isTaskLike(parentObject) ? parentObject : null;

    switch (tagName) {
      case "name":
        parentObject.name = processedText.replace(/\s+/g, " ").trim() || processedText.trim() || "";
        if (!parentObject.name && text.length > 0) {
          this.logger.log(LogLevel.DEBUG, "Name normalization resulted in empty string", { id: parentObject.id });
        }
        break;
      case "added":
        parentObject.added = this.parseDate(processedText);
        break;
      case "modified":
        parentObject.modified = this.parseDate(processedText);
        break;
      case "rank":
        parentObject.rank = parseNumber(processedText, 10);
        break;
      case "flagged":
        if (taskObject) {
          taskObject.flagged = processedText === "true";
        }
        break;
      case "order":
        if (taskObject) {
          taskObject.order = processedText;
        }
        break;
      case "start":
        if (taskObject) {
          taskObject.start = this.parseDate(processedText);
        }
        break;
      case "due":
        if (taskObject) {
          taskObject.due = this.parseDate(processedText);
        }
        break;
      case "completed":
        if (taskObject) {
          taskObject.completed = this.parseDate(processedText);
        }
        break;
      case "repeat":
        if (taskObject) {
          taskObject.repeat = processedText;
        }
        break;
      case "repetition-rule":
        if (taskObject) {
          taskObject.repetitionRule = processedText;
        }
        break;
      case "repetition-method":
        if (taskObject) {
          taskObject.repetitionMethod = processedText;
        }
        break;
      case "singleton":
        if (taskObject) {
          taskObject.project.singleton = processedText === "true";
        }
        break;
      case "review-interval":
        if (taskObject) {
          taskObject.project.reviewInterval = processedText;
        }
        break;
      case "last-review":
        if (taskObject) {
          taskObject.project.lastReview = this.parseDate(processedText);
        }
        break;
      case "status":
        this.setStatus(parentObject, processedText);
        break;
      case "hidden":
        this.setHidden(parentObject, processedText);
        break;
      case "prohibits-next-action":
        if (parentObject.type === "context") {
          parentObject.prohibitsNextAction = processedText === "true";
        }
        break;
      case "tasks-user-ordered":
        if (parentObject.type === "context") {
          parentObject.tasksUserOrdered = processedText === "true";
        }
        break;
      case "children-are-mutually-exclusive":
        if (parentObject.type === "context") {
          parentObject.childrenAreMutuallyExclusive = processedText === "true";
        }
        break;
      case "estimated-minutes":
        if (taskObject) {
          taskObject.estimatedMinutes = parseNumber(processedText, 10);
        }
        break;
      case "completed-by-children":
        if (taskObject) {
          taskObject.completedByChildren = processedText === "true";
        }
        break;
      case "next-clone-identifier":
        if (taskObject) {
          taskObject.nextCloneIdentifier = processedText;
        }
        break;
      case "due-date-alarm-policy":
        if (taskObject) {
          taskObject.dueDateAlarmPolicy = processedText;
        }
        break;
      case "defer-date-alarm-policy":
        if (taskObject) {
          taskObject.deferDateAlarmPolicy = processedText;
        }
        break;
      case "latest-time-to-start-alarm-policy":
        if (taskObject) {
          taskObject.latestTimeToStartAlarmPolicy = processedText;
        }
        break;
      case "planned-date-alarm-policy":
        if (taskObject) {
          taskObject.plannedDateAlarmPolicy = processedText;
        }
        break;
      case "repetition-schedule-type":
        if (taskObject) {
          taskObject.repetitionScheduleType = processedText;
        }
        break;
      case "repetition-anchor-date":
        if (taskObject) {
          taskObject.repetitionAnchorDate = this.parseDate(processedText);
        }
        break;
      case "planned":
        if (taskObject) {
          taskObject.planned = this.parseDate(processedText);
        }
        break;
      case "catch-up-automatically":
        if (taskObject) {
          taskObject.catchUpAutomatically = processedText === "true";
        }
        break;
      case "inbox":
        if (parentObject.type === "task" || parentObject.type === "project") {
          parentObject.inbox = processedText === "true";
        }
        break;
      case "next-review":
        if (taskObject) {
          taskObject.project.nextReview = this.parseDate(processedText);
        }
        break;
      case "rank-in-task":
      case "rank-in-tag":
        break;
      default:
        break;
    }
  }

  private parseDate(text: string): Date | null {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private isTaskLike(value: Context | Folder | BaseTask): value is BaseTask {
    return value.type === "task" || value.type === "project";
  }

  private setStatus(obj: Context | Folder | BaseTask, text: string): void {
    if (this.isTaskLike(obj)) {
      obj.project.status = text;
      if (!["active", "inactive", "done", "dropped", "paused", "on-hold", "onhold", "cancelled", "canceled"].includes(text)) {
        this.logger.logUnknownPropertyValue("status", text, obj.type);
      }
      return;
    }

    if (obj.type === "context") {
      if (text === "active" || text === "paused" || text === "dropped") {
        obj.status = text;
      } else {
        obj.status = "active";
        this.logger.logUnknownPropertyValue("status", text, "context");
      }
      return;
    }

    if (obj.type === "folder") {
      obj.status = text;
      if (!["active", "inactive", "dropped"].includes(text)) {
        this.logger.logUnknownPropertyValue("status", text, "folder");
      }
    }
  }

  private setHidden(obj: Context | Folder | BaseTask, text: string): void {
    let hidden = false;
    let hiddenAt: Date | null = null;
    const lower = text.toLowerCase();

    if (lower === "true") {
      hidden = true;
    } else if (lower !== "false" && text.trim() !== "") {
      hiddenAt = this.parseDate(text);
      hidden = Boolean(hiddenAt);
    }

    obj.hidden = hidden;
    if (obj.type === "folder") {
      obj.hiddenAt = hiddenAt;
    }
  }
}
