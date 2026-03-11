import type { Folder } from "../../types.js";
import { EntityFactory, type EntityAttributes } from "../EntityFactory.js";
import type { DeleteProcessor } from "../processors/DeleteProcessor.js";
import type { ParserState } from "../utils/ParserState.js";

export class FolderHandler {
  constructor(
    private readonly state: ParserState,
    private readonly deleteProcessor: DeleteProcessor
  ) {}

  handleStart(attrs: Record<string, string>): void {
    if (attrs.op === "delete" && attrs.id) {
      this.deleteProcessor.deleteFolder(attrs.id);
      this.state.skipFolderLevel += 1;
      return;
    }

    if (attrs.op === "update" && attrs.id) {
      const folder = this.state.folderMap.get(attrs.id) ?? EntityFactory.createFolder(attrs as EntityAttributes);
      this.state.pushObject(folder);
      this.state.pushElement("folder");
      return;
    }

    if (attrs.op === "reference") {
      this.state.skipFolderLevel += 1;
      return;
    }

    if (!attrs.id) {
      this.handleReference(attrs);
      const projectEntry = this.state.getCurrentProjectStackEntry();
      if (projectEntry) {
        projectEntry.hasChildren = true;
      }
      this.state.skipFolderLevel += 1;
      return;
    }

    const folder = EntityFactory.createFolder(attrs as EntityAttributes);
    this.state.pushObject(folder);
    this.state.pushElement("folder");
  }

  handleEnd(): void {
    if (this.state.getCurrentElement() !== "folder") {
      return;
    }

    const folder = this.state.popObject() as Folder | undefined;
    this.state.popElement();
    if (folder && !this.deleteProcessor.isFolderDeleted(folder.id)) {
      this.state.folderMap.set(folder.id, folder);
    }
  }

  handleReference(attrs: Record<string, string>): void {
    const parent = this.state.getCurrentParent();
    if (!parent) {
      return;
    }

    const idref = attrs.idref ?? null;
    if (parent.type === "folder") {
      parent.parentFolderId = idref;
      return;
    }

    if (parent.type === "task" || parent.type === "project") {
      parent.containerId = idref;
    }
  }

  isSkipping(): boolean {
    return this.state.skipFolderLevel > 0;
  }

  decrementSkipLevel(): void {
    if (this.state.skipFolderLevel > 0) {
      this.state.skipFolderLevel -= 1;
    }
  }
}

