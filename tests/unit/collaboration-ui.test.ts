import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CollaborationWorkbench, filterCollaborationRecords, relatedCollaborationRoutes, addCollaborationTag, type CollaborationRecord } from '../../apps/desktop/src/collaboration-workbench.tsx';
import { PeopleContext } from '../../apps/desktop/src/avatars.tsx';

const project:CollaborationRecord={id:'p',name:'联机搬运',revision:2,tags:['联机']};
it('finds an idea by associated project and retains case-insensitive content search',()=>{
 const records:CollaborationRecord[]=[{id:'linked',name:'状态回放',body:'Server prediction',project_id:'p',revision:1},{id:'solo',name:'像素角色',body:'动作',revision:1}];
 expect(filterCollaborationRecords(records,'联机搬运','','',[project]).map(r=>r.id)).toEqual(['linked']);
 expect(filterCollaborationRecords(records,'SERVER','','').map(r=>r.id)).toEqual(['linked']);
 expect(filterCollaborationRecords(records,'不存在','','')).toEqual([]);
});
it('combines tags with priority and orders high-priority work first without modifying input',()=>{
 const records:CollaborationRecord[]=[{id:'low',name:'次要',priority:'low',tags:['联机'],revision:1},{id:'high',name:'重要',priority:'high',tags:['联机'],revision:1},{id:'other',name:'别的',priority:'high',tags:['像素'],revision:1}];
 expect(filterCollaborationRecords(records,'','','联机').map(r=>r.id)).toEqual(['high','low']);
 expect(filterCollaborationRecords(records,'','low','联机').map(r=>r.id)).toEqual(['low']);
 expect(records[0].id).toBe('low');
});
it('renders C navigation, actual member identities and the provided account slot with escaped names',()=>{
 const markup=renderToStaticMarkup(React.createElement(PeopleContext.Provider,{value:{people:[{id:'me',name:'江微雪'},{id:'other',name:'<script>成员</script>'}],mode:'cloud',refresh:async()=>{}}},React.createElement(CollaborationWorkbench,{profile:'me',account:React.createElement('button',{},'账户选项')})));
 expect(markup).toContain('记录列表');
 expect(markup).toContain('记录详情');
 expect(markup).toContain('江微雪');
 expect(markup).toContain('账户选项');
 expect(markup).toContain('&lt;script&gt;成员&lt;/script&gt;');
 expect(markup).not.toContain('<script>成员</script>');
 expect(markup).not.toContain('羊咩');
});
it('shows the original, sibling and descendant routes without unrelated experiments',()=>{
 const base:CollaborationRecord={id:'base',name:'原路线',revision:1};
 const source=(id:string)=>({entity_type:'experiment' as const,entity_id:id,revision:1,author_id:'owner',snapshot:{}});
 const branch={id:'branch',name:'分支',revision:1,source:source('base')};
 const sibling={id:'sibling',name:'另一路',revision:1,source:source('base')};
 const child={id:'child',name:'继续试验',revision:1,source:source('branch')};
 expect(relatedCollaborationRoutes('experiment',branch,[],[base,branch,sibling,child,{id:'other',name:'无关',revision:1}]).map(x=>x.record.id)).toEqual(['base','branch','sibling','child']);
});
it('normalizes new tags, prevents case duplicate and respects bounded count',()=>{
 expect(addCollaborationTag(['联机'],'  像素  动作 ')).toEqual(['联机','像素 动作']);
 expect(addCollaborationTag(['Server'],'server')).toEqual(['Server']);
 expect(addCollaborationTag(Array.from({length:30},(_,i)=>String(i)),'新标签')).toHaveLength(30);
});
