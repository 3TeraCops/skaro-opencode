/** Changes only the requested tasks, preserving selection in other columns or filters. */
export function selectTasks(selected: string[], ids: string[], on: boolean): string[] {
  const next = new Set(selected);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return [...next];
}
