import {describe,it,expect} from 'vitest';
import {DraftWriteAttempt, navigationBlocked} from '../../apps/desktop/src/library-write-guard.ts';
describe('library write recovery',()=>{
 it('blocks synchronous busy or unresolved navigation',()=>{expect(navigationBlocked(false,true,null)).toBe(true);expect(navigationBlocked(false,false,{busy:false})).toBe(true);expect(navigationBlocked(false,false,null)).toBe(false);});
 it('retries the saved payload and revision despite disabled form fields or refreshed revision',()=>{const draft=new DraftWriteAttempt();const original=draft.prepare('comment_create',{body:'原文'},3,false);draft.finish(true);expect(draft.prepare('comment_create',{body:''},9,true)).toEqual(original);expect(()=>draft.prepare('project_update',{},9,true)).toThrow();});
 it('keeps a snapshot when the original custom sections are later mutated',()=>{const draft=new DraftWriteAttempt();const payload={custom_sections:[{title:'原标题',content:'原内容'}]};draft.prepare('retrospective_create',payload,4,false);payload.custom_sections[0].content='改动';draft.finish(true);expect(draft.prepare('retrospective_create',{},5,true).payload).toEqual({custom_sections:[{title:'原标题',content:'原内容'}]});});
 it('allows editing and new submission after definitive rejection or success',()=>{const draft=new DraftWriteAttempt();draft.prepare('project_update',{description:'A'},1,false);draft.finish(false);expect(draft.prepare('project_update',{description:'B'},2,false).payload).toEqual({description:'B'});});
});
