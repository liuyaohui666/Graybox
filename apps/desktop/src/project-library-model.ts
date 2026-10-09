export const lifecycleNames: Record<string,string> = {todo:'待做',in_progress:'进行中',completed:'已完成',paused:'暂停'};
export const priorityNames: Record<string,string> = {high:'高',medium:'中',low:'低'};
export const outcomeNames: Record<string,string> = {success:'成功',partial:'部分成功',failure:'失败',inconclusive:'尚无结论'};
export const reportSections = {goal:'目标',approach:'做法',result:'结果',verification:'验证与证据',failures:'失败与问题',reusable:'可复用内容',lessons:'经验与教训',next_steps:'下一步'};
export const lifecycleLabel = (value: string) => lifecycleNames[value] ?? value;
export const outcomeLabel = (value: string) => outcomeNames[value] ?? value;
export const normalizeTag = (value: string) => value.trim().replace(/\s+/g,' ').toLowerCase();
export function addTag(tags: string[], value: string, catalog: {name:string}[]) {
  const normalized = normalizeTag(value);
  if(!normalized || tags.some(t=>normalizeTag(t)===normalized)) return tags;
  return [...tags, catalog.find(t=>normalizeTag(t.name)===normalized)?.name ?? value.trim().replace(/\s+/g,' ')];
}
export function prioritizedIdeas<T extends {lifecycle:string;priority:string}>(items:T[]) {
  const order:Record<string,number> = {high:0,medium:1,low:2};
  return items.filter(p=>['todo','in_progress'].includes(p.lifecycle)).sort((a,b)=>(order[a.priority]??1)-(order[b.priority]??1));
}
export function filterProjects<T extends {name:string;description:string;tags:string[]}>(items:T[], search:string, tag:string) {
  return items.filter(p=>(!tag || p.tags.some(t=>normalizeTag(t)===normalizeTag(tag))) && `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
}
export function reportPayload(projectId:string, form:FormData, custom:{title:string;content:string}[]) {
  return {project_id:projectId,title:String(form.get('title')??'').trim(),outcome:String(form.get('outcome')??'inconclusive'),...Object.fromEntries(Object.keys(reportSections).map(key=>[key,String(form.get(key)??'').trim()])),custom_sections:custom.map(s=>({title:s.title.trim(),content:s.content.trim()}))};
}
