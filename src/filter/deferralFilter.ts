import type { Task } from "../types.js";

export function deduplicateRecurringTasks(tasks: Task[]): Task[] {
  const recurringGroups = new Map<string, Task[]>();
  const nonRecurring: Task[] = [];

  for (const task of tasks) {
    if (!task.repetitionRule) {
      nonRecurring.push(task);
      continue;
    }
    const key = `${task.name ?? ""}-${task.containerId ?? ""}-${task.repetitionRule}`;
    const group = recurringGroups.get(key) ?? [];
    group.push(task);
    recurringGroups.set(key, group);
  }

  const nowKey = new Date().toISOString().slice(0, 16);
  const deduplicated: Task[] = [];
  for (const group of recurringGroups.values()) {
    if (group.length === 1) {
      deduplicated.push(group[0]!);
      continue;
    }

    const availableInstances = group.filter((task) => !task.start || task.start.toISOString().slice(0, 16) <= nowKey);
    if (availableInstances.length === 0) {
      continue;
    }

    availableInstances.sort((a, b) => {
      if (!a.start && !b.start) {
        return 0;
      }
      if (!a.start) {
        return 1;
      }
      if (!b.start) {
        return -1;
      }
      return b.start.toISOString().slice(0, 16).localeCompare(a.start.toISOString().slice(0, 16));
    });
    deduplicated.push(availableInstances[0]!);
  }

  return [...nonRecurring, ...deduplicated];
}

