import {useEffect,useMemo,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

type Knowledge={id:string;name:string;status:'未开始'|'学习中'|'已掌握'|'待复习';note:string;review?:string};
type Branch={id:string;name:string;items:Knowledge[]};
type Direction={id:string;name:string;description:string;branches:Branch[]};

const seed:Direction[]=[{id:'game-dev',name:'游戏开发',description:'长期学习方向',branches:[{id:'godot',name:'Godot',items:[{id:'scene',name:'场景与节点',status:'已掌握',note:'理解节点树、场景实例和信号。'},{id:'input',name:'输入与状态机',status:'学习中',note:'整理角色控制与状态切换。',review:'2026-11-20'}]},{id:'math',name:'游戏数学',items:[{id:'vector',name:'向量与坐标变换',status:'待复习',note:'补充旋转、插值和局部坐标。',review:'2026-11-18'}]}]}];

export function LearningPage(){
  const [directions,setDirections]=useState(seed),[selected,setSelected]=useState('game-dev'),[filter,setFilter]=useState('全部');
  const [dialog,setDialog]=useState(false),[newName,setNewName]=useState('');
  useEffect(()=>{void invoke<Direction[]>('learning_list').then(items=>{if(items.length){setDirections(items);setSelected(items[0].id);}}).catch(()=>{});},[]);
  const direction=directions.find(item=>item.id===selected)??directions[0];
  const visible=useMemo(()=>direction?.branches.map(branch=>({...branch,items:branch.items.filter(item=>filter==='全部'||item.status===filter)})).filter(branch=>branch.items.length),[direction,filter]);
  async function addDirection(e:React.FormEvent){e.preventDefault();const name=newName.trim();if(!name)return;let created:Direction={id:crypto.randomUUID(),name,description:'长期学习方向',branches:[]};try{created=await invoke<Direction>('learning_create_direction',{name,description:created.description});}catch{}setDirections(items=>[...items,created]);setSelected(created.id);setNewName('');setDialog(false);}
  async function addBranch(directionId:string){const name=window.prompt('分支名称');if(!name?.trim())return;let created:Branch={id:crypto.randomUUID(),name:name.trim(),items:[]};try{created=await invoke<Branch>('learning_create_branch',{directionId,name:name.trim()});}catch{}setDirections(items=>items.map(d=>d.id===directionId?{...d,branches:[...d.branches,created]}:d));}
  async function addKnowledge(branchId:string){const name=window.prompt('知识点名称');if(!name?.trim())return;let created:Knowledge={id:crypto.randomUUID(),name:name.trim(),status:'未开始',note:'',review:undefined};try{created=await invoke<Knowledge>('learning_create_knowledge',{branchId,name:name.trim(),status:'未开始',note:'',review:null});}catch{}setDirections(items=>items.map(d=>({...d,branches:d.branches.map(b=>b.id===branchId?{...b,items:[...b.items,created]}:b)})));}
  return <section className="learning-page">
    <div className="learning-intro"><div><p className="eyebrow">个人学习</p><h2>学习方向</h2><p>把长期目标拆成分支，再落到可以掌握的小知识点。</p></div><button className="primary" onClick={()=>setDialog(true)}>＋ 新建方向</button></div>
    <div className="learning-layout"><aside className="learning-directions"><div className="learning-side-title">我的方向 <span>{directions.length}</span></div>{directions.map(item=><button key={item.id} className={item.id===selected?'selected':''} onClick={()=>setSelected(item.id)}><strong>{item.name}</strong><small>{item.description}</small><em>{item.branches.reduce((n,b)=>n+b.items.length,0)} 个知识点</em></button>)}</aside>
      <div className="learning-content">{direction&&<><div className="learning-content-head"><div><h3>{direction.name}</h3><p>{direction.description}</p></div><div className="learning-actions"><button className="secondary" onClick={()=>addBranch(direction.id)}>＋ 分支</button><select aria-label="筛选学习状态" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部</option><option>未开始</option><option>学习中</option><option>已掌握</option><option>待复习</option></select></div></div>{visible?.length?visible.map(branch=><section className="learning-branch" key={branch.id}><div className="learning-branch-head"><h4>{branch.name}</h4><button className="text-button" onClick={()=>addKnowledge(branch.id)}>＋ 知识点</button></div>{branch.items.map(item=><article className="knowledge-row" key={item.id}><div><strong>{item.name}</strong><p>{item.note||'尚未记录笔记'}</p></div><span className={`learning-status status-${item.status}`}>{item.status}</span>{item.review&&<time>复习：{item.review}</time>}</article>)}</section>):<div className="empty learning-empty">这个方向还没有符合筛选条件的知识点。</div>}</>}</div></div>
    {dialog&&<dialog open className="modal learning-modal"><form onSubmit={addDirection}><h3>新建学习方向</h3><label>方向名称<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} placeholder="例如：英语阅读"/></label><p>方向建立后，可以继续添加分支和知识点。</p><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setDialog(false)}>取消</button><button className="primary">创建方向</button></div></form></dialog>}
  </section>;
}
