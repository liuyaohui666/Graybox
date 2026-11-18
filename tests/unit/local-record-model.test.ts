import { describe, expect, it } from 'vitest';
import { createMode, createSelection, withoutPriority } from '../../packages/local-db/src/local-record.ts';

describe('local record creation', () => {
  it('keeps only the selected creation form active', () => {
    expect(createMode('idea')).toEqual({ project: false, idea: true, experiment: false });
    expect(createMode('experiment')).toEqual({ project: false, idea: false, experiment: true });
  });

  it('maps a creation choice to the matching workspace tab', () => {
    expect(createSelection('idea')).toEqual({ tab: 'ideas', project: false, idea: true, experiment: false });
  });

  it('removes priority from local record data', () => {
    expect(withoutPriority({ name: '记录', priority: 'high', tags: ['本地'] })).toEqual({ name: '记录', tags: ['本地'] });
  });
});
