(function(root){
'use strict';
const stats = values => {
 const sorted=values.slice().sort((a,b)=>a-b), n=sorted.length;
 if(!n)return null;
 return {n,mean:sorted.reduce((a,b)=>a+b,0)/n,median:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,p90:sorted[Math.ceil(n*.9)-1],max:sorted[n-1]};
};
function summarize(records){
 const seen=new Set(),groups=new Map(), rejected=[];
 for(const r of records){
  const reason=!r||r.study!=='excel-gate-startup-study-1'||r.schemaVersion!==1?'形式不一致':r.valid!==true?'無効な計測':!['baseline','minimal','direct'].includes(r.profile)?'方式不明':!Number.isFinite(r.totalMs)||r.totalMs<0||!Number.isFinite(r.handoffMs)||r.handoffMs<0||!r.phasesMs||Object.values(r.phasesMs).some(x=>!Number.isFinite(x)||x<0)?'時間不正':!Number.isFinite(r.startedLocalMs)?'開始時刻不正':'';
  if(reason){rejected.push(reason);continue;}
  const id=r.profile+':'+r.startedLocalMs;
  if(seen.has(id)){rejected.push('同じ起動の重複');continue;}seen.add(id);
  const key=JSON.stringify([r.browserState,r.host,r.dataSet,r.browser]);
  if(!groups.has(key))groups.set(key,{browserState:r.browserState,host:r.host,dataSet:r.dataSet,browser:r.browser,profiles:{}});
  const g=groups.get(key);(g.profiles[r.profile]??=[]).push(r);
 }
 return {rejected,groups:[...groups.values()].map(g=>{
  const profiles={};
  for(const [name,rows] of Object.entries(g.profiles)){
   const phaseNames=new Set(rows.flatMap(r=>Object.keys(r.phasesMs)));
   profiles[name]={total:stats(rows.map(r=>r.totalMs)),handoff:stats(rows.map(r=>r.handoffMs)),phases:Object.fromEntries([...phaseNames].map(p=>[p,stats(rows.map(r=>r.phasesMs[p]).filter(Number.isFinite))])),observedInputs:rows.filter(r=>r.userInputObserved).length};
  }
  return {...g,profiles,medianReductionMs:profiles.baseline&&profiles.minimal?profiles.baseline.total.median-profiles.minimal.total.median:null,medianRemainingVsDirectMs:profiles.minimal&&profiles.direct?profiles.minimal.total.median-profiles.direct.total.median:null};
 })};
}
const api={stats,summarize};if(typeof module==='object'&&module.exports)module.exports=api;else root.StartupSummary=api;
})(typeof globalThis==='undefined'?this:globalThis);
