import {useMemo,useState} from 'react';

type Knowledge={id:string;name:string;status:'未开始'|'学习中'|'已掌握'|'待复习';note:string;review?:string};
type Branch={id:string;name:string;items:Knowledge[]};
type Direction={id:string;name:string;description:string;branches:Branch[]};

const seed:Direction[]=[{id:'game-dev',name:'游戏开发',description:'长期学习方向',branches:[{id:'godot',name:'Godot',items:[{id:'scene',name:'场景与节点',status:'已掌握',note:'理解节点树、场景实例和信号。'},{id:'input',name:'输入与状态机',status:'学习中',note:'整理角色控制与状态切换。',review:'2026-11-20'}]},{id:'math',name:'游戏数学',items:[{id:'vector',name:'向量与坐标变换',status:'待复习',note:'补充旋转、插值和局部坐标。',review:'2026-11-18'}]}]}];

export function LearningPage(){
  const [directions,setDirections]=useState(seed),[selected,setSelected]=useState('game-dev'),[filter,setFilter]=useState('全部');
  const [dialog,setDialog]=useState(false),[newName,setNewName]=useState('');
  const direction=directions.find(item=>item.id===selected)??directions[0];
  const visible=useMemo(()=>direction?.branches.map(branch=>({...branch,items:branch.items.filter(item=>filter==='全部'||item.status===filter)})).filter(branch=>branch.items.length),[direction,filter]);
  function addDirection(e:React.FormEvent){e.preventDefault();const name=newName.trim();if(!name)return;const id=crypto.randomUUID();setDirections(items=>[...items,{id,name,description:'长期学习方向',branches:[]}]);setSelected(id);setNewName('');setDialog(false);}
  return <section className="learning-page">
    <div className="learning-intro"><div><p className="eyebrow">个人学习</p><h2>学习方向</h2><p>把长期目标拆成分支，再落到可以掌握的小知识点。</p></div><button className="primary" onClick={()=>setDialog(true)}>＋ 新建方向</button></div>
    <div className="learning-layout"><aside className="learning-directions"><div className="learning-side-title">我的方向 <span>{directions.length}</span></div>{directions.map(item=><button key={item.id} className={item.id===selected?'selected':''} onClick={()=>setSelected(item.id)}><strong>{item.name}</strong><small>{item.description}</small><em>{item.branches.reduce((n,b)=>n+b.items.length,0)} 个知识点</em></button>)}</aside>
      <div className="learning-content">{direction&&<><div className="learning-content-head"><div><h3>{direction.name}</h3><p>{direction.description}</p></div><select aria-label="筛选学习状态" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部</option><option>未开始</option><option>学习中</option><option>已掌握</option><option>待复习</option></select></div>{visible?.length?visible.map(branch=><section className="learning-branch" key={branch.id}><div className="learning-branch-head"><h4>{branch.name}</h4><button className="text-button">＋ 知识点</button></div>{branch.items.map(item=><article className="knowledge-row" key={item.id}><div><strong>{item.name}</strong><p>{item.note}</p></div><span className={`learning-status status-${item.status}`}>{item.status}</span>{item.review&&<time>复习：{item.review}</time>}</article>)}</section>):<div className="empty learning-empty">这个方向还没有符合筛选条件的知识点。</div>}</>}</div></div>
    {dialog&&<dialog open className="modal learning-modal"><form onSubmit={addDirection}><h3>新建学习方向</h3><label>方向名称<input autoFocus value={newName} onChange={e=>setNewName(e.target.value)} placeholder="例如：英语阅读"/></label><p>方向建立后，可以继续添加分支和知识点。</p><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setDialog(false)}>取消</button><button className="primary">创建方向</button></div></form></dialog>}
  </section>;
}
