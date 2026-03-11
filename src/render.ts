import { createContextTree, createInboxTree, createProjectTree } from "./snapshot.js";
import type { OmniFocusSnapshot, Project, RenderTaskChartOptions, Task, TreeNode } from "./types.js";
import { HTMLCleaner } from "./utils/htmlCleaner.js";

function printTree(lines: string[], nodes: TreeNode[], indent = "", isLast = true, noteMaxLength = 80): void {
  nodes.forEach((node, index) => {
    const isLastChild = index === nodes.length - 1;
    const prefix = indent + (isLast ? "└── " : "├── ");
    const childIndent = indent + (isLast ? "    " : "│   ");

    let icon = "";
    if (node.type === "folder") {
      icon = "[F] ";
    } else if (node.type === "project") {
      icon = "[P] ";
    } else if (node.type === "task") {
      icon = (node.item as Task).completed ? "[x] " : "[ ] ";
    }

    let line = `${prefix}${icon}${node.name ?? ""}`;
    if (node.attributes.length > 0) {
      line += ` (${node.attributes.join(", ")})`;
    }
    lines.push(line);

    const note = node.type === "task" ? HTMLCleaner.truncate((node.item as Task).note, noteMaxLength) : node.type === "project" ? HTMLCleaner.truncate((node.item as Project).note, noteMaxLength) : null;
    if (note) {
      lines.push(`${childIndent}    - ${note}`);
    }

    if (node.children.length > 0) {
      printTree(lines, node.children, childIndent, isLastChild, noteMaxLength);
    }
  });
}

export function renderTaskChart(snapshot: OmniFocusSnapshot, options: RenderTaskChartOptions = {}): string {
  const lines: string[] = [];
  const noteMaxLength = options.noteMaxLength ?? 80;

  lines.push(`OmniFocus Database Summary (${snapshot.filter} view)`);
  lines.push("=".repeat(50));
  lines.push(`Folders: ${snapshot.filtered.folders.filter((folder) => !folder.hidden).length}`);
  lines.push(
    `Projects: ${snapshot.filtered.projects.length}${snapshot.filter === "all" ? "" : ` (of ${snapshot.all.projects.length})`}`
  );
  lines.push(`Tasks: ${snapshot.filtered.tasks.length}${snapshot.filter === "all" ? "" : ` (of ${snapshot.all.tasks.length})`}`);
  if (snapshot.partition.inboxFilteredCount > 0) {
    lines.push(`Inbox: ${snapshot.partition.inboxFilteredCount} tasks`);
  }
  lines.push(`Tags/Contexts: ${snapshot.all.contexts.length}`);

  lines.push("");
  lines.push("TAGS/CONTEXTS:");
  lines.push("-".repeat(40));
  printTree(lines, createContextTree(snapshot), "", true, noteMaxLength);

  if (snapshot.partition.inboxTasks.length > 0) {
    lines.push("");
    lines.push("INBOX:");
    lines.push("-".repeat(40));
    printTree(lines, createInboxTree(snapshot), "", true, noteMaxLength);
  }

  lines.push("");
  lines.push("FOLDERS & PROJECTS:");
  lines.push("-".repeat(40));
  printTree(lines, createProjectTree(snapshot), "", true, noteMaxLength);

  return lines.join("\n");
}

