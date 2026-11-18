import {beforeEach,expect,test,vi} from 'vitest';
const fixture=vi.hoisted(()=>({activity:vi.fn(),resolve:vi.fn()}));
vi.mock('../../packages/local-context/src/binding.ts',()=>({resolveContext:fixture.resolve,executeCommand:vi.fn(),undoExecutionContext:vi.fn(),activateIdea:vi.fn(),activateExperiment:vi.fn()}));
import {activityList} from '../../apps/mcp/src/tools.ts';
beforeEach(()=>{fixture.resolve.mockResolvedValue({project:{id:'project'},binding:{workspace_id:'workspace'},api:{activity:fixture.activity}});fixture.activity.mockReset();});
test('explicit entity and batch reads include independent idea activity in the bound workspace',async()=>{
 const row={id:'activity',entity_type:'idea',entity_id:'idea',project_id:null,after:{workspace_id:'workspace'}};
 fixture.activity.mockResolvedValue([row]);
 expect(await activityList('C:/test',{entity_id:'idea'})).toEqual([row]);
 expect(await activityList('C:/test',{batch_id:'batch'})).toEqual([row]);
});
test('unfiltered reads retain the project boundary',async()=>{
 const linked={id:'linked',project_id:'project'},unlinked={id:'unlinked',entity_type:'idea',project_id:null,after:{workspace_id:'workspace'}};
 fixture.activity.mockResolvedValue([linked,unlinked]);
 expect(await activityList('C:/test',{})).toEqual([linked]);
});
test('explicit reads exclude other projects and independent ideas in other workspaces',async()=>{
 fixture.activity.mockResolvedValue([{project_id:'other'},{entity_type:'idea',project_id:null,after:{workspace_id:'other'}},{entity_type:'idea',project_id:null,after:null}]);
 expect(await activityList('C:/test',{batch_id:'batch'})).toEqual([]);
});
