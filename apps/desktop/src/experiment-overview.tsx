import React from 'react';
export type ExperimentReport={done:string[];failed:string[];reusable:string[];pending:string[];other?:string[]};
const sections=[['done','做了什么'],['failed','什么行不通'],['reusable','可复用经验'],['pending','待定事项'],['other','其他']] as const;
export function legacyReport(summary:string):ExperimentReport{
 const report:ExperimentReport={done:[],failed:[],reusable:[],pending:[]};
 const names:Record<string,keyof ExperimentReport>={'做了什么':'done','历程':'done','结果':'done','进展':'done','做法':'done','失败':'failed','失败原因':'failed','什么行不通':'failed','问题':'failed','可复用':'reusable','可复用经验':'reusable','保留经验':'reusable','经验':'reusable','待定':'pending','待定事项':'pending','下一步':'pending','待验证':'pending','其他':'other'};
 for(const line of summary.split('\n')){const match=line.match(/^\s*([^：:]{1,12})[：:]\s*(.+)$/);if(match&&names[match[1]])(report[names[match[1]]]??=[]).push(match[2]);}
 return report;
}
function Point({text}:{text:string}){return text.length>120?<details className="cw-report-point"><summary>{text.slice(0,100)}… <b>展开</b></summary><p>{text}</p></details>:<span>{text}</span>;}
export function ExperimentOverview({record}:{record:{report?:ExperimentReport|null;summary?:string;change_summary?:string}}){
 const report=record.report??legacyReport(record.summary??'');
 return <section className="cw-section" aria-label="实验要点"><div className="cw-report-grid">{sections.map(([key,title])=>{const points=(report[key]??[]).flatMap(point=>point.split(/\r?\n/).map(line=>line.trim().replace(/^[-*•]\s*/, '')).filter(Boolean));return <article key={key} className={`cw-report-card cw-report-${key}`}><h3>{title}</h3>{points.length?<ul>{points.map((point,i)=><li key={i}><Point text={point}/></li>)}</ul>:<p className="cw-muted">尚未记录</p>}</article>;})}</div>{(record.summary||record.change_summary)&&<details className="cw-legacy-report"><summary>查看原有正文与变更说明</summary>{record.summary&&<p className="cw-body">{record.summary}</p>}{record.change_summary&&<><h4>变更说明</h4><p className="cw-body">{record.change_summary}</p></>}</details>}</section>;
}
