import sax from "sax";

import { LogLevel, LoggerService } from "../logger.js";
import type { OmniFocusDocument } from "../types.js";
import { ContextHandler } from "./handlers/ContextHandler.js";
import { FolderHandler } from "./handlers/FolderHandler.js";
import { ProjectHandler } from "./handlers/ProjectHandler.js";
import { PropertyHandler } from "./handlers/PropertyHandler.js";
import { TagRelationshipHandler } from "./handlers/TagRelationshipHandler.js";
import { TaskHandler } from "./handlers/TaskHandler.js";
import { DeleteProcessor } from "./processors/DeleteProcessor.js";
import { NoteProcessor } from "./processors/NoteProcessor.js";
import { EntityDeduplicator } from "./utils/EntityDeduplicator.js";
import { ParserState } from "./utils/ParserState.js";

export class SaxOmniFocusParser {
  logger: LoggerService;
  private currentFilePath?: string;

  private readonly state = new ParserState();
  private readonly noteProcessor = new NoteProcessor(this.state);
  private readonly deleteProcessor = new DeleteProcessor(this.state);
  private readonly contextHandler = new ContextHandler(this.state, this.deleteProcessor);
  private readonly folderHandler = new FolderHandler(this.state, this.deleteProcessor);
  private readonly taskHandler = new TaskHandler(this.state, this.deleteProcessor);
  private readonly projectHandler = new ProjectHandler(this.state);
  private readonly tagRelationshipHandler = new TagRelationshipHandler(this.state);
  private readonly propertyHandler: PropertyHandler;

  private readonly knownElements = new Set([
    "omnifocus",
    "setting",
    "context",
    "folder",
    "task",
    "project",
    "note",
    "location",
    "name",
    "added",
    "modified",
    "rank",
    "flagged",
    "order",
    "start",
    "due",
    "completed",
    "repeat",
    "repetition-rule",
    "repetition-method",
    "singleton",
    "review-interval",
    "last-review",
    "status",
    "perspective",
    "style",
    "font-style",
    "file-attachment",
    "run",
    "lit",
    "attachment",
    "inbox-task",
    "child-count",
    "available-task-count",
    "remaining-task-count",
    "leaf-count",
    "note-expanded",
    "hidden",
    "prohibits-next-action",
    "tasks-user-ordered",
    "children-are-mutually-exclusive",
    "estimated-minutes",
    "completed-by-children",
    "next-clone-identifier",
    "due-date-alarm-policy",
    "defer-date-alarm-policy",
    "latest-time-to-start-alarm-policy",
    "planned-date-alarm-policy",
    "repetition-schedule-type",
    "repetition-anchor-date",
    "planned",
    "catch-up-automatically",
    "inbox",
    "next-review",
    "task-to-tag",
    "rank-in-task",
    "rank-in-tag",
    "reference-snapshot",
    "delete-snapshot",
    "plist",
    "dict",
    "key",
    "string",
    "integer",
    "true",
    "false",
    "array",
    "date",
    "data",
    "icon-attachment",
    "value"
  ]);

  private readonly knownAttributes = new Map<string, Set<string>>([
    ["context", new Set(["id", "idref", "op"])],
    ["folder", new Set(["id", "idref", "op"])],
    ["task", new Set(["id", "idref", "op"])],
    ["project", new Set(["id"])],
    ["location", new Set(["name", "latitude", "longitude", "radius", "notificationFlags"])],
    ["setting", new Set(["id", "op"])],
    ["perspective", new Set(["id"])],
    ["style", new Set(["id"])],
    ["font-style", new Set(["id", "font-family", "font-size"])],
    ["file-attachment", new Set(["id", "name"])],
    ["run", new Set(["id"])],
    ["lit", new Set(["id"])],
    ["attachment", new Set(["idref"])],
    ["task-to-tag", new Set(["id", "op"])],
    ["inbox-task", new Set(["id", "idref", "op"])],
    ["plist", new Set(["version"])]
  ]);

  constructor(logger?: LoggerService, filePath?: string) {
    this.currentFilePath = filePath;
    this.logger = logger ?? new LoggerService(LogLevel.WARN, filePath);
    this.propertyHandler = new PropertyHandler(this.state, this.logger);
    this.taskHandler.setProjectHandler(this.projectHandler);
  }

  parseMultiple(xmlStrings: string[], filePath?: string): OmniFocusDocument {
    this.state.clearEntities();
    this.logger.reset();
    if (filePath) {
      this.currentFilePath = filePath;
      this.logger.currentFilePath = filePath;
    }

    for (const xmlString of xmlStrings) {
      this.parseSingle(xmlString);
    }

    this.state.extractEntities();
    this.state.applyInboxOverrides();
    const deduplicated = EntityDeduplicator.deduplicateRecurringTasks(this.state.tasks, this.state.projects);
    this.state.tasks = deduplicated.tasks;
    this.state.projects = deduplicated.projects;
    this.logger.getSummary();

    return {
      contexts: this.state.contexts,
      folders: this.state.folders,
      projects: this.state.projects,
      tasks: this.state.tasks,
      tagRelationships: this.state.tagRelationships
    };
  }

  parse(xmlString: string, filePath?: string): OmniFocusDocument {
    return this.parseMultiple([xmlString], filePath);
  }

  private parseSingle(xmlString: string): void {
    const parser = sax.parser(true, {
      trim: false,
      normalize: false,
      xmlns: false,
      position: false,
      lowercase: false,
      strictEntities: false
    });

    parser.onerror = (error: Error) => {
      this.logger.logParseError(error as Error, `Current tag: ${this.state.currentParentTag}`);
    };
    parser.ontext = (text: string) => this.handleText(text);
    parser.onopentag = (node: { name: string; attributes: Record<string, string> }) =>
      this.handleOpenTag(node.name, node.attributes as Record<string, string>);
    parser.onclosetag = (tagName: string) => this.handleCloseTag(tagName);

    try {
      parser.write(xmlString);
      parser.close();
    } catch (error) {
      this.logger.logParseError(error as Error, "Failed to parse XML document");
      throw error;
    }
  }

  private handleOpenTag(tagName: string, attrs: Record<string, string>): void {
    const previousParent = this.state.currentParentTag;
    this.state.currentParentTag = tagName;

    if (!this.noteProcessor.isCollecting()) {
      this.state.currentText = "";
    }

    if (this.noteProcessor.isCollecting()) {
      this.noteProcessor.appendOpenTag(tagName, attrs, false);
      return;
    }

    if (previousParent) {
      this.state.trackSiblingElement(previousParent, tagName);
    }

    if (!this.knownElements.has(tagName)) {
      this.logger.logUnknownElement({
        tagName,
        attributes: attrs,
        parentTag: previousParent ?? undefined,
        filePath: this.currentFilePath,
        parentChain: [...this.state.elementStack].slice(-4, -1),
        siblingTags: previousParent ? this.state.getSiblings(previousParent).filter((tag) => tag !== tagName) : [],
        textContent: undefined
      });
    }

    this.checkUnknownAttributes(tagName, attrs);

    switch (tagName) {
      case "context":
        this.contextHandler.handleStart(attrs);
        break;
      case "folder":
        this.folderHandler.handleStart(attrs);
        break;
      case "task":
        this.taskHandler.handleStart(attrs);
        break;
      case "project":
        this.projectHandler.handleStart();
        break;
      case "location":
        this.handleLocationStart(attrs);
        break;
      case "note":
        this.noteProcessor.startNoteCollection();
        break;
      case "task-to-tag":
        this.tagRelationshipHandler.handleTaskToTagStart(attrs);
        break;
      case "inbox-task":
        this.tagRelationshipHandler.handleInboxTask(attrs);
        break;
      default:
        break;
    }
  }

  private handleCloseTag(tagName: string): void {
    if (this.noteProcessor.isCollecting()) {
      if (!this.noteProcessor.handleNoteEnd(tagName)) {
        return;
      }
      this.state.currentParentTag = this.state.elementStack.at(-1) ?? null;
      return;
    }

    if (this.taskHandler.isSkipping() && tagName === "task") {
      this.taskHandler.decrementSkipLevel();
    } else if (this.folderHandler.isSkipping() && tagName === "folder") {
      this.folderHandler.decrementSkipLevel();
    } else if (this.contextHandler.isSkipping() && tagName === "context") {
      this.contextHandler.decrementSkipLevel();
    } else {
      this.handlePropertyClose(tagName);

      switch (tagName) {
        case "task":
          this.taskHandler.handleEnd();
          break;
        case "folder":
          this.folderHandler.handleEnd();
          break;
        case "context":
          this.contextHandler.handleEnd();
          break;
        case "project":
          this.projectHandler.handleEnd();
          break;
        case "task-to-tag":
          this.tagRelationshipHandler.handleTaskToTagEnd();
          break;
        default:
          break;
      }
    }

    this.state.currentText = "";
    this.state.currentParentTag = this.state.elementStack.at(-1) ?? null;
  }

  private handleText(text: string): void {
    if (this.noteProcessor.isCollecting()) {
      this.noteProcessor.appendText(text);
      return;
    }

    this.state.currentText += text;
  }

  private handlePropertyClose(tagName: string): void {
    const propertyTags = new Set([
      "name",
      "added",
      "modified",
      "rank",
      "flagged",
      "order",
      "start",
      "due",
      "completed",
      "repeat",
      "repetition-rule",
      "repetition-method",
      "singleton",
      "review-interval",
      "last-review",
      "status",
      "hidden",
      "prohibits-next-action",
      "tasks-user-ordered",
      "children-are-mutually-exclusive",
      "estimated-minutes",
      "completed-by-children",
      "next-clone-identifier",
      "due-date-alarm-policy",
      "defer-date-alarm-policy",
      "latest-time-to-start-alarm-policy",
      "planned-date-alarm-policy",
      "repetition-schedule-type",
      "repetition-anchor-date",
      "planned",
      "catch-up-automatically",
      "inbox",
      "next-review",
      "rank-in-task",
      "rank-in-tag"
    ]);

    if (propertyTags.has(tagName)) {
      this.propertyHandler.setProperty(tagName, this.state.currentText);
    }
  }

  private handleLocationStart(attrs: Record<string, string>): void {
    const parent = this.state.getCurrentParent();
    if (parent?.type !== "context") {
      return;
    }

    parent.location = {
      name: attrs.name ?? null,
      latitude: attrs.latitude ? Number.parseFloat(attrs.latitude) : null,
      longitude: attrs.longitude ? Number.parseFloat(attrs.longitude) : null,
      radius: attrs.radius ? Number.parseFloat(attrs.radius) : null,
      notificationFlags: attrs.notificationFlags ? Number.parseInt(attrs.notificationFlags, 10) : null
    };
  }

  private checkUnknownAttributes(tagName: string, attrs: Record<string, string>): void {
    const knownAttributes = this.knownAttributes.get(tagName);
    if (!knownAttributes) {
      return;
    }

    for (const [attributeName, attributeValue] of Object.entries(attrs)) {
      if (!knownAttributes.has(attributeName)) {
        this.logger.logUnknownAttribute(tagName, attributeName, attributeValue);
      }
    }
  }
}
