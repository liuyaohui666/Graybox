import { describe, it, expect } from 'vitest';
import { prioritizedIdeas, lifecycleLabel, outcomeLabel, addTag, filterProjects, reportPayload } from '../../apps/desktop/src/project-library-model.ts';
import { allowedLocalRequest } from '../../apps/desktop/src/request-path.ts';
describe('project library model', () => {
  it('orders active ideas by priority and keeps outcome independent', () => {
    const items = [{id:'a', lifecycle:'todo',priority:'low'}, {id:'b',lifecycle:'completed',priority:'high'}, {id:'c',lifecycle:'in_progress',priority:'high'}];
    expect(prioritizedIdeas(items).map(p=>p.id)).toEqual(['c','a']);
    expect(lifecycleLabel('completed')).toBe('已完成'); expect(outcomeLabel('failure')).toBe('失败');
  });
  it('deduplicates normalized selected and new tags without deleting catalog', () => {
    expect(addTag([' Game  Art '], 'game art', [{name:'Game Art'}])).toEqual([' Game  Art ']);
    expect(addTag([], 'game art', [{name:'Game Art'}])).toEqual(['Game Art']);
    expect(filterProjects([{name:'A',description:'创意',tags:['Game Art']}], '创意', 'game art')).toHaveLength(1);
  });
  it('forms exact retrospective data with all sections and custom sections', () => {
    const f = new FormData(); f.set('title','报告'); f.set('outcome','partial');
    expect(reportPayload('p',f,[{title:'附录',content:'观察'}])).toEqual({project_id:'p',title:'报告',outcome:'partial',goal:'',approach:'',result:'',verification:'',failures:'',reusable:'',lessons:'',next_steps:'',custom_sections:[{title:'附录',content:'观察'}]});
  });
});
describe('local bridge routes', () => {
  it('only allows the human directory read and own avatar write methods',()=>{
    expect(allowedLocalRequest('/v1/people','GET')).toBe(true);expect(allowedLocalRequest('/v1/profile/avatar','POST')).toBe(true);
    expect(allowedLocalRequest('/v1/people','POST')).toBe(false);expect(allowedLocalRequest('/v1/profile/avatar','GET')).toBe(false);expect(allowedLocalRequest('/v1/profile/avatar/other','POST')).toBe(false);
  });
  it('allows tags and encoded Chinese queries only on read routes', () => {
    expect(allowedLocalRequest('/v1/tags?workspace_id=abc-123&q=%E6%B8%B8%E6%88%8F','GET')).toBe(true);
    expect(allowedLocalRequest('/v1/projects?tag=Game%20Art','GET')).toBe(true);
    for(const path of ['/v1/projects%2f..%2fsecret','/v1/tags?q=%ZZ','/v1/tags?q=%00','https://evil/v1/projects','/v1/../projects','/v1/projects/abc/unknown']) expect(allowedLocalRequest(path,'GET')).toBe(false);
    expect(allowedLocalRequest('/v1/tags','POST')).toBe(false);
  });
});
