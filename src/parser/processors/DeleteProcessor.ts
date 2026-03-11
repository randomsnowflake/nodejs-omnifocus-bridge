import type { ParserState } from "../utils/ParserState.js";

export class DeleteProcessor {
  constructor(private readonly state: ParserState) {}

  deleteContext(id: string): void {
    this.state.deletedContextIds.add(id);
    this.state.contextMap.delete(id);
  }

  deleteFolder(id: string): void {
    this.state.deletedFolderIds.add(id);
    this.state.folderMap.delete(id);
  }

  deleteTask(id: string): void {
    this.state.deletedTaskIds.add(id);
    this.state.taskMap.delete(id);
  }

  isContextDeleted(id: string): boolean {
    return this.state.deletedContextIds.has(id);
  }

  isFolderDeleted(id: string): boolean {
    return this.state.deletedFolderIds.has(id);
  }

  isTaskDeleted(id: string): boolean {
    return this.state.deletedTaskIds.has(id);
  }
}

