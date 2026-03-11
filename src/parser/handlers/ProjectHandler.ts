import type { ParserState } from "../utils/ParserState.js";

export class ProjectHandler {
  constructor(private readonly state: ParserState) {}

  handleStart(): void {
    const parentTask = this.state.getCurrentParent();
    this.state.pushProjectStackEntry({
      hasChildren: false,
      parentTask: parentTask?.type === "task" || parentTask?.type === "project" ? parentTask : null
    });
  }

  handleEnd(): void {
    const projectInfo = this.state.popProjectStackEntry();
    if (projectInfo?.parentTask && projectInfo.hasChildren) {
      projectInfo.parentTask.isProject = true;
    }
  }

  markHasChildren(): void {
    const entry = this.state.getCurrentProjectStackEntry();
    if (entry) {
      entry.hasChildren = true;
    }
  }

  isInProject(): boolean {
    return this.state.projectStack.length > 0;
  }
}

