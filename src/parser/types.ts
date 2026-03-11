import type { BaseTask } from "../types.js";

export type ProjectStackEntry = {
  hasChildren: boolean;
  parentTask: BaseTask | null;
};

