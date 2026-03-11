import type { TagRelationship } from "../../types.js";
import type { ParserState } from "../utils/ParserState.js";

export class TagRelationshipHandler {
  constructor(private readonly state: ParserState) {}

  handleTaskToTagStart(attrs: Record<string, string>): void {
    if (!attrs.id) {
      return;
    }

    this.state.currentTagRelationship = {
      tagId: attrs.id,
      taskId: "",
      rankInTask: null,
      rankInTag: null,
      added: null,
      contextId: null
    };
  }

  handleTaskToTagEnd(): void {
    if (this.state.currentTagRelationship?.taskId) {
      this.state.tagRelationships.push(this.state.currentTagRelationship as TagRelationship);
    }
    this.state.currentTagRelationship = null;
  }

  handleInboxTask(attrs: Record<string, string>): void {
    const id = attrs.idref ?? attrs.id;
    if (!id) {
      return;
    }

    if (attrs.op === "delete") {
      this.state.inboxTaskIds.delete(id);
      return;
    }

    if (attrs.op !== "reference") {
      this.state.inboxTaskIds.add(id);
    }
  }
}

