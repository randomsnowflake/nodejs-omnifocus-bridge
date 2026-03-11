export type Location = {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  notificationFlags: number | null;
};

export type Context = {
  type: "context";
  id: string;
  name: string | null;
  added: Date | null;
  modified: Date | null;
  rank: number | null;
  parentContextId: string | null;
  location: Location | null;
  hidden: boolean;
  prohibitsNextAction: boolean;
  tasksUserOrdered: boolean;
  childrenAreMutuallyExclusive: boolean;
  status: "active" | "paused" | "dropped" | null;
};

export type Folder = {
  type: "folder";
  id: string;
  name: string | null;
  added: Date | null;
  modified: Date | null;
  rank: number | null;
  parentFolderId: string | null;
  hidden: boolean;
  hiddenAt?: Date | null;
  status?: "active" | "dropped" | "inactive" | string | null;
};

export type ProjectFields = {
  singleton: boolean;
  reviewInterval: string | null;
  lastReview: Date | null;
  status: string | null;
  nextReview: Date | null;
};

export type AvailabilityStatus =
  | "available"
  | "blocked_by_project"
  | "blocked_by_context"
  | "blocked_by_tag"
  | "parent_blocked"
  | "project_inactive"
  | "child_blocked"
  | "deferred"
  | "hidden"
  | "unavailable";

export type BaseTask = {
  type: "task" | "project";
  id: string;
  name: string | null;
  added: Date | null;
  modified: Date | null;
  rank: number | null;
  note: string | null;
  flagged: boolean;
  order: string | null;
  start: Date | null;
  due: Date | null;
  completed: Date | null;
  repeat: string | null;
  repetitionRule: string | null;
  repetitionMethod: string | null;
  containerId: string | null;
  contextId: string | null;
  isProject: boolean;
  project: ProjectFields;
  hidden: boolean;
  estimatedMinutes: number | null;
  completedByChildren: boolean;
  nextCloneIdentifier: string | null;
  dueDateAlarmPolicy: string | null;
  deferDateAlarmPolicy: string | null;
  latestTimeToStartAlarmPolicy: string | null;
  plannedDateAlarmPolicy: string | null;
  repetitionScheduleType: string | null;
  repetitionAnchorDate: Date | null;
  planned: Date | null;
  catchUpAutomatically: boolean;
  inbox: boolean;
  availabilityStatus?: AvailabilityStatus;
};

export type Task = BaseTask & { type: "task" };
export type Project = BaseTask & { type: "project" };

export type TagRelationship = {
  taskId: string;
  tagId: string;
  rankInTask: number | null;
  rankInTag: number | null;
  added: Date | null;
  contextId: string | null;
};

export type TaskStatusFilter =
  | "available"
  | "remaining"
  | "dropped"
  | "completed"
  | "all";

export type OmniFocusDocument = {
  contexts: Context[];
  folders: Folder[];
  projects: Project[];
  tasks: Task[];
  tagRelationships: TagRelationship[];
};

export type OmniFocusCollections = {
  contexts: Context[];
  folders: Folder[];
  projects: Project[];
  tasks: Task[];
};

export type TaskDisplayPartition = {
  inboxTasks: Task[];
  nonInboxTasks: Task[];
  displayTasks: Task[];
  inboxFilteredCount: number;
};

export type OmniFocusSnapshot = {
  filter: TaskStatusFilter;
  all: OmniFocusDocument;
  filtered: OmniFocusCollections;
  partition: TaskDisplayPartition;
};

export type TreeNode = {
  type: "folder" | "project" | "task" | "context";
  id: string;
  name: string | null;
  item: Folder | Project | Task | Context;
  children: TreeNode[];
  attributes: string[];
};

export type OmniFocusSourceMode = "auto" | "local" | "vault";

export type OmniFocusReaderOptions = {
  source?: OmniFocusSourceMode;
  path?: string;
  password?: string;
  readAllPatches?: boolean;
};

export type OmniFocusSourceResolution = {
  source: "local" | "vault";
  path: string;
};

export type RenderTaskChartOptions = {
  noteMaxLength?: number;
};

