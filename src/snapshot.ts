import { TaskFilterService } from "./filter/TaskFilterService.js";
import { OmniFocusFormatter } from "./utils/formatter.js";
import type {
  Context,
  Folder,
  OmniFocusCollections,
  OmniFocusDocument,
  OmniFocusSnapshot,
  Project,
  Task,
  TaskDisplayPartition,
  TaskStatusFilter,
  TreeNode
} from "./types.js";

function partitionTasks(allData: OmniFocusDocument, filteredData: OmniFocusCollections): TaskDisplayPartition {
  const taskById = new Map(allData.tasks.map((task) => [task.id, task]));
  const projectIds = new Set(allData.projects.map((project) => project.id));
  const projectById = new Map(allData.projects.map((project) => [project.id, project]));

  const ensureAncestors = (task: Task, targetSet: Set<string>) => {
    let containerId = task.containerId;
    const visited = new Set<string>();
    while (containerId) {
      if (projectIds.has(containerId) || visited.has(containerId)) {
        return;
      }
      visited.add(containerId);
      const parentTask = taskById.get(containerId);
      if (!parentTask) {
        return;
      }
      targetSet.add(parentTask.id);
      containerId = parentTask.containerId;
    }
  };

  const isInboxTask = (task: Task): boolean => {
    if (task.inbox) {
      return true;
    }
    let containerId = task.containerId;
    const visited = new Set<string>();
    while (containerId) {
      if (projectIds.has(containerId)) {
        return Boolean(projectById.get(containerId)?.inbox);
      }
      if (visited.has(containerId)) {
        break;
      }
      visited.add(containerId);
      const parentTask = taskById.get(containerId);
      if (!parentTask) {
        return true;
      }
      if (parentTask.inbox) {
        return true;
      }
      containerId = parentTask.containerId;
    }
    return !containerId;
  };

  const inboxTaskIds = new Set<string>();
  const nonInboxTaskIds = new Set<string>();
  let inboxFilteredCount = 0;

  for (const task of filteredData.tasks) {
    const targetSet = isInboxTask(task) ? inboxTaskIds : nonInboxTaskIds;
    targetSet.add(task.id);
    ensureAncestors(task, targetSet);
    if (targetSet === inboxTaskIds) {
      inboxFilteredCount += 1;
    }
  }

  const toOrderedArray = (ids: Set<string>) => allData.tasks.filter((task) => ids.has(task.id));
  return {
    inboxTasks: toOrderedArray(inboxTaskIds),
    nonInboxTasks: toOrderedArray(nonInboxTaskIds),
    displayTasks: toOrderedArray(new Set([...inboxTaskIds, ...nonInboxTaskIds])),
    inboxFilteredCount
  };
}

function buildContextTree(contexts: Context[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const context of contexts) {
    nodeMap.set(context.id, {
      type: "context",
      id: context.id,
      name: context.name,
      item: context,
      children: [],
      attributes: OmniFocusFormatter.getContextAttributes(context)
    });
  }

  for (const context of contexts) {
    const node = nodeMap.get(context.id)!;
    if (context.parentContextId) {
      const parent = nodeMap.get(context.parentContextId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  sortNodesByRank(roots);
  return roots;
}

function buildProjectTree(
  folders: Folder[],
  projects: Project[],
  tasks: Task[],
  contextsMap: Map<string, Context>,
  filterMode: TaskStatusFilter,
  options: { allowOrphanTasks?: boolean } = {}
): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const folder of folders) {
    if (!isItemVisible(folder, filterMode)) {
      continue;
    }
    nodeMap.set(folder.id, { type: "folder", id: folder.id, name: folder.name, item: folder, children: [], attributes: [] });
  }

  for (const project of projects) {
    if (!isItemVisible(project, filterMode)) {
      continue;
    }
    nodeMap.set(project.id, {
      type: "project",
      id: project.id,
      name: project.name,
      item: project,
      children: [],
      attributes: OmniFocusFormatter.getProjectAttributes(project, contextsMap)
    });
  }

  for (const task of tasks) {
    if (!isItemVisible(task, filterMode)) {
      continue;
    }
    const attributes: string[] = [];
    if (task.contextId) {
      const context = contextsMap.get(task.contextId);
      if (context?.name) {
        attributes.push(`@${context.name}`);
      }
    }
    attributes.push(...OmniFocusFormatter.getTaskAttributes(task));
    nodeMap.set(task.id, { type: "task", id: task.id, name: task.name, item: task, children: [], attributes });
  }

  const connectNode = (item: Folder | Project | Task) => {
    const node = nodeMap.get(item.id);
    if (!node) {
      return;
    }
    const parentId =
      "parentFolderId" in item && item.parentFolderId ? item.parentFolderId : "containerId" in item ? item.containerId : null;
    if (parentId) {
      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }
    if (node.type !== "task" || options.allowOrphanTasks) {
      roots.push(node);
    }
  };

  folders.forEach(connectNode);
  projects.forEach(connectNode);
  tasks.forEach(connectNode);

  sortNodesByRank(roots);
  return removeEmptyFolders(roots);
}

function isItemVisible(item: Folder | Project | Task, filterMode: TaskStatusFilter): boolean {
  if (item.hidden && filterMode !== "all") {
    return false;
  }

  if (item.type === "project") {
    const status = item.project.status?.toLowerCase();
    const dropped = status === "dropped" || status === "cancelled" || status === "canceled";
    if (dropped && filterMode !== "dropped" && filterMode !== "all") {
      return false;
    }
  }
  return true;
}

function sortNodesByRank(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    const rankA = "rank" in a.item ? a.item.rank : null;
    const rankB = "rank" in b.item ? b.item.rank : null;
    if (rankA === null && rankB === null) {
      return 0;
    }
    if (rankA === null) {
      return 1;
    }
    if (rankB === null) {
      return -1;
    }
    return rankA - rankB;
  });
  nodes.forEach((node) => sortNodesByRank(node.children));
}

function removeEmptyFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: removeEmptyFolders(node.children) }))
    .filter((node) => (node.type === "folder" ? node.children.length > 0 : true));
}

export function createSnapshot(document: OmniFocusDocument, filter: TaskStatusFilter): OmniFocusSnapshot {
  const filterService = new TaskFilterService();
  filterService.setDocument(document);

  let filteredProjects = filterService.filterProjects(document.projects, filter);
  const filteredTasks = filterService.filterTasks(document.tasks, filter);

  if (filter === "available") {
    const projectIds = new Set(filteredProjects.map((project) => project.id));
    const allTasksById = new Map(document.tasks.map((task) => [task.id, task]));
    const projectsWithTasks = new Set<string>();

    for (const task of filteredTasks) {
      let containerId = task.containerId;
      const visited = new Set<string>();
      while (containerId) {
        if (visited.has(containerId)) {
          break;
        }
        visited.add(containerId);
        if (projectIds.has(containerId)) {
          projectsWithTasks.add(containerId);
          break;
        }
        containerId = allTasksById.get(containerId)?.containerId ?? null;
      }
    }

    filteredProjects = filteredProjects.filter((project) => projectsWithTasks.has(project.id));
  }

  const filtered: OmniFocusCollections = {
    contexts: document.contexts,
    folders: filter === "all" ? document.folders : document.folders.filter((folder) => !folder.hidden),
    projects: filteredProjects,
    tasks: filteredTasks
  };

  return {
    filter,
    all: document,
    filtered,
    partition: partitionTasks(document, filtered)
  };
}

export function createContextTree(snapshot: OmniFocusSnapshot): TreeNode[] {
  return buildContextTree(snapshot.all.contexts);
}

export function createInboxTree(snapshot: OmniFocusSnapshot): TreeNode[] {
  return buildProjectTree([], [], snapshot.partition.inboxTasks, new Map(snapshot.all.contexts.map((context) => [context.id, context])), snapshot.filter, {
    allowOrphanTasks: true
  });
}

export function createProjectTree(snapshot: OmniFocusSnapshot): TreeNode[] {
  return buildProjectTree(
    snapshot.filtered.folders,
    snapshot.filtered.projects,
    snapshot.partition.nonInboxTasks,
    new Map(snapshot.all.contexts.map((context) => [context.id, context])),
    snapshot.filter
  );
}
