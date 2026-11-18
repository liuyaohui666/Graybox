import type {Project} from './model.ts';

export const boardStages = [
  {id:'ideas',label:'想法'},
  {id:'active',label:'进行中'},
  {id:'done',label:'完成与复盘'},
] as const;
export type BoardStage = typeof boardStages[number]['id'];

/** Unknown lifecycles stay reachable in the active column with their original label. */
export function groupProjects(projects:Project[]):Record<BoardStage,Project[]> {
  const groups:Record<BoardStage,Project[]> = {ideas:[],active:[],done:[]};
  const priority:Record<string,number> = {high:0,medium:1,low:2};
  for(const project of projects) {
    const stage = project.lifecycle==='todo'?'ideas':project.lifecycle==='completed'?'done':'active';
    groups[stage].push(project);
  }
  for(const stage of boardStages) groups[stage.id].sort((a,b)=>(priority[a.priority]??1)-(priority[b.priority]??1));
  return groups;
}
