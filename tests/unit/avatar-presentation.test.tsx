import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect,vi,afterEach} from 'vitest';
import {Avatar,Attribution,PeopleContext} from '../../apps/desktop/src/avatars.tsx';
import {displayName,personLabel,AvatarGeneration,avatarCrop,prepareAvatar} from '../../apps/desktop/src/avatar-model.ts';
test('local demo presentation is short and real names are preserved',()=>{
 expect(displayName({name:'Owner demonstration'},'local')).toBe('本地用户1');
 expect(displayName({name:'Member one demonstration'},'local')).toBe('本地用户2');
 expect(displayName({name:'Member two demonstration'},'local')).toBe('本地用户3');
 expect(displayName({name:'Owner demonstration'},'cloud')).toBe('Owner demonstration');
 expect(displayName({name:'江微雪'},'local')).toBe('江微雪');
 expect(personLabel({name:'Owner demonstration',role:'owner'},'local')).toBe('本地用户1');
});
test('compact avatar uses person name without global role and agent identity remains visible',()=>{
 const person={id:'a',name:'江微雪',role:'owner',avatar_data:null};
 const render=(id:string,agentId?:string)=>renderToStaticMarkup(<PeopleContext.Provider value={{people:[person],mode:'cloud',refresh:async()=>{}}}><Attribution id={id} agentId={agentId}/></PeopleContext.Provider>);
 expect(render('a')).toContain('title="江微雪"');expect(render('a')).toContain('aria-label="江微雪"');expect(render('a')).not.toContain('owner');
 expect(render('a','agent')).toContain('Agent');expect(render('missing')).toContain('历史记录未注明');
 expect(renderToStaticMarkup(<Avatar person={{...person,role:'member',avatar_data:'https://bad'}}/>)).not.toContain('https://bad');
});
test('late conversion cannot upload for changed profile, session or newer operation',()=>{
 const guard=new AvatarGeneration();const token=guard.begin('a',1);expect(guard.current(token,'a',1)).toBe(true);
 expect(guard.current(token,'b',1)).toBe(false);expect(guard.current(token,'a',2)).toBe(false);
 guard.begin('a',1);expect(guard.current(token,'a',1)).toBe(false);guard.cancel();
});
test('crop uses centered square for portrait and landscape',()=>{
 expect(avatarCrop(800,400)).toEqual({x:200,y:0,size:400});expect(avatarCrop(400,800)).toEqual({x:0,y:200,size:400});
 expect(()=>avatarCrop(0,1)).toThrow();
});
afterEach(()=>vi.unstubAllGlobals());
test('upload decodes WebP, crops square and exports bounded canonical PNG while releasing decoded bitmap',async()=>{
 const drawImage=vi.fn(),close=vi.fn(),canvas={width:0,height:0,getContext:()=>({drawImage}),toDataURL:vi.fn(()=> 'data:image/png;base64,AAAA')};
 vi.stubGlobal('document',{createElement:()=>canvas});vi.stubGlobal('createImageBitmap',async()=>({width:800,height:400,close}));
 expect(await prepareAvatar(new File(['webp'],'avatar.webp',{type:'image/webp'}))).toBe('data:image/png;base64,AAAA');
 expect(canvas.width).toBe(192);expect(canvas.height).toBe(192);expect(drawImage.mock.calls[0]!.slice(1)).toEqual([200,0,400,400,0,0,192,192]);expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');expect(close).toHaveBeenCalledOnce();
 canvas.toDataURL.mockReturnValue('x'.repeat(180001));await expect(prepareAvatar(new File(['png'],'a.png',{type:'image/png'}))).rejects.toThrow('过大');expect(close).toHaveBeenCalledTimes(2);
 await expect(prepareAvatar(new File(['svg'],'a.svg',{type:'image/svg+xml'}))).rejects.toThrow('PNG');
});

import {SidebarAccount} from '../../apps/desktop/src/avatars.tsx';
import {allowedLocalRequest} from '../../apps/desktop/src/request-path.ts';
test('renamed people replace cached sidebar and attribution names; nickname route stays narrow',()=>{
 const old={id:'a',name:'Old name',role:'member'},person={...old,name:'New name'};
 const html=renderToStaticMarkup(<PeopleContext.Provider value={{people:[person],mode:'cloud',refresh:async()=>{}}}><SidebarAccount profile="a" person={old} locked={false} setBusy={()=>{}}/><Attribution id="a" name="Old name" detail/></PeopleContext.Provider>);
 expect(html).toContain('New name');expect(html).not.toContain('Old name');expect(html).toContain('个人资料');
 expect(allowedLocalRequest('/v1/profile/name','POST')).toBe(true);
 for(const path of ['/v1/profile/name/other','/v1/profile/name?name=x','/v1/profile/role'])expect(allowedLocalRequest(path,'POST')).toBe(false);
 expect(allowedLocalRequest('/v1/profile/name','GET')).toBe(false);
});
