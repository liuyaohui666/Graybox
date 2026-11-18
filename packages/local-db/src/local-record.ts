export type CreateKind = 'project' | 'idea' | 'experiment';

export function createMode(kind: CreateKind) {
  return {
    project: kind === 'project',
    idea: kind === 'idea',
    experiment: kind === 'experiment',
  };
}

export function createSelection(kind: CreateKind) {
  return {
    tab: kind === 'project' ? 'projects' : kind === 'idea' ? 'ideas' : 'experiments',
    ...createMode(kind),
  } as const;
}

export function withoutPriority<T extends Record<string, unknown>>(data: T): Omit<T, 'priority'> {
  const { priority: _priority, ...rest } = data;
  return rest;
}
