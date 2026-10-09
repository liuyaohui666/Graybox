import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {AvatarEditor,PeopleContext} from '../../apps/desktop/src/avatars.tsx';
it('cloud account actions no longer occupy the workspace top bar',()=>{
 const source=readFileSync('apps/desktop/src/cloud-ui.tsx','utf8');
 expect(source).not.toContain('className="cloud-controls"');
});
it('local avatar menu preserves profile controls without cloud account actions',()=>{
 const html=renderToStaticMarkup(<PeopleContext.Provider value={{people:[{id:'a',name:'本地用户'}],mode:'local',refresh:async()=>{}}}><AvatarEditor profile="a" locked={true} setBusy={()=>{}}/></PeopleContext.Provider>);
 expect(html).toContain('头像选项');expect(html).not.toContain('avatar-menu');
 expect(html).not.toContain('退出登录');expect(html).not.toContain('团队管理');
});
