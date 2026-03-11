import type { BaseTask, Project, Task } from "../../types.js";

export class EntityDeduplicator {
  static deduplicateRecurringTasks(tasks: Task[], projects: Project[]): { tasks: Task[]; projects: Project[] } {
    const allTasks: BaseTask[] = [...tasks, ...projects];
    const grouped = this.groupRecurringTasks(allTasks);
    const toKeep = this.selectTasksToKeep(grouped);

    return {
      tasks: tasks.filter((task) => !this.isRecurringTask(task) || toKeep.has(task.id)),
      projects: projects.filter((project) => !this.isRecurringTask(project) || toKeep.has(project.id))
    };
  }

  private static groupRecurringTasks(tasks: BaseTask[]): Map<string, BaseTask[]> {
    const groups = new Map<string, BaseTask[]>();

    for (const task of tasks) {
      if (!this.isRecurringTask(task)) {
        continue;
      }

      const key = [task.name ?? "", task.containerId ?? "", task.repeat ?? "", task.repetitionRule ?? "", task.contextId ?? ""].join("_");
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }

    return groups;
  }

  private static isRecurringTask(task: BaseTask): boolean {
    return Boolean(task.repeat || task.repetitionRule);
  }

  private static selectTasksToKeep(taskGroups: Map<string, BaseTask[]>): Set<string> {
    const toKeep = new Set<string>();

    for (const group of taskGroups.values()) {
      if (group.length <= 1) {
        toKeep.add(group[0]!.id);
        continue;
      }

      group.sort((a, b) => {
        if (a.completed && !b.completed) {
          return 1;
        }
        if (!a.completed && b.completed) {
          return -1;
        }
        if (!a.completed && !b.completed) {
          if (a.start && b.start) {
            return b.start.getTime() - a.start.getTime();
          }
          if (a.start && !b.start) {
            return -1;
          }
          if (!a.start && b.start) {
            return 1;
          }
        }
        if (a.completed && b.completed) {
          return b.completed.getTime() - a.completed.getTime();
        }
        const aDate = a.modified ?? a.added;
        const bDate = b.modified ?? b.added;
        if (aDate && bDate) {
          return bDate.getTime() - aDate.getTime();
        }
        return 0;
      });

      let hasIncomplete = false;
      for (const task of group) {
        if (!task.completed && !hasIncomplete) {
          toKeep.add(task.id);
          hasIncomplete = true;
        }
      }
    }

    return toKeep;
  }
}

