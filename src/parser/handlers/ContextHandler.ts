import type { Context } from "../../types.js";
import { EntityFactory, type EntityAttributes } from "../EntityFactory.js";
import type { DeleteProcessor } from "../processors/DeleteProcessor.js";
import type { ParserState } from "../utils/ParserState.js";

export class ContextHandler {
  constructor(
    private readonly state: ParserState,
    private readonly deleteProcessor: DeleteProcessor
  ) {}

  handleStart(attrs: Record<string, string>): void {
    if (attrs.op === "delete" && attrs.id) {
      this.deleteProcessor.deleteContext(attrs.id);
      this.state.skipContextLevel += 1;
      return;
    }

    if (attrs.op === "update" && attrs.id) {
      const context = this.state.contextMap.get(attrs.id) ?? EntityFactory.createContext(attrs as EntityAttributes);
      this.state.pushObject(context);
      this.state.pushElement("context");
      return;
    }

    if (attrs.op === "reference") {
      this.state.skipContextLevel += 1;
      return;
    }

    if (!attrs.id) {
      this.handleReference(attrs);
      this.state.skipContextLevel += 1;
      return;
    }

    const context = EntityFactory.createContext(attrs as EntityAttributes);
    this.state.pushObject(context);
    this.state.pushElement("context");
  }

  handleEnd(): void {
    if (this.state.getCurrentElement() !== "context") {
      return;
    }

    const context = this.state.popObject() as Context | undefined;
    this.state.popElement();
    if (context && !this.deleteProcessor.isContextDeleted(context.id)) {
      this.state.contextMap.set(context.id, context);
    }
  }

  handleReference(attrs: Record<string, string>): void {
    const parent = this.state.getCurrentParent();
    if (!parent) {
      return;
    }

    const idref = attrs.idref ?? null;
    if (parent.type === "context") {
      parent.parentContextId = idref;
      return;
    }

    if (parent.type === "task" || parent.type === "project") {
      parent.contextId = idref;
    }
  }

  isSkipping(): boolean {
    return this.state.skipContextLevel > 0;
  }

  decrementSkipLevel(): void {
    if (this.state.skipContextLevel > 0) {
      this.state.skipContextLevel -= 1;
    }
  }
}

