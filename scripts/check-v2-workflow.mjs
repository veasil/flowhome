import {readFileSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export function validate(w,{root=process.cwd(),observed}={}){
 const errors=[],tasks=w.tasks||[],ids=new Set(),by=new Map(tasks.map(t=>[t.id,t]));
 const err=(p,m)=>errors.push(`${p}: ${m}`);
 const ref=p=>typeof p==='string'&&!isAbsolute(p)&&!relative(root,resolve(root,p)).startsWith('..')&&existsSync(resolve(root,p));
 for(const [i,t]of tasks.entries()){
  const p=`tasks[${i}](${t.id})`;if(ids.has(t.id))err(p,'duplicate id');ids.add(t.id);
  if(!t.id||!t.owner||!t.reviewer||t.owner===t.reviewer)err(p,'distinct owner/reviewer required');
  if(!['queued','active','review','accepted','blocked','rejected','inconclusive'].includes(t.status))err(p,'invalid status');
  if(t.contractVersion!==w.contractVersion)err(p,'contract version mismatch');
  if(!t.acceptance?.length||!t.falsifier||!t.limits?.length||!Number.isInteger(t.maxRevisions)||t.maxRevisions<1)err(p,'missing acceptance/falsifier/limits/revision budget');
  for(const d of t.dependsOn||[]){if(!by.has(d))err(p,`missing dependency ${d}`);if(t.status==='accepted'&&by.get(d)?.status!=='accepted')err(p,`dependency ${d} not accepted`);}
  for(const f of [...(t.inputRefs||[]),...(t.outputs||[]),...(t.evidenceRefs||[]),...(t.reviewEvidenceRefs||[])])if(!ref(f))err(p,`missing or unsafe reference ${f}`);
  if(t.status==='accepted'){
   if(t.reviewDecision!=='accept'||!t.outputs?.length||!t.evidenceRefs?.length||!t.reviewEvidenceRefs?.length)err(p,'accepted requires independent review evidence, outputs and evidence');
   for(const f of t.reviewEvidenceRefs||[]){if(!ref(f))continue;try{const r=JSON.parse(readFileSync(resolve(root,f),'utf8'));if(r.taskId!==t.id||r.reviewer!==t.reviewer||r.decision!=='accept'||!r.reviewedAt||!Object.keys(r.inputHashes||{}).length)err(p,'review identity/decision/version mismatch');for(const [path,hash]of Object.entries(r.inputHashes||{}))if(!ref(path)||createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')!==hash)err(p,`stale review input ${path}`);}catch{err(p,'invalid review evidence JSON');}}
   for(const kind of t.requiredEvidenceTypes||[]){const item=(t.evidenceItems||[]).find(e=>e.kind===kind);if(!item||!ref(item.path))err(p,`required evidence missing: ${kind}`);}
  }
 }
 const visiting=new Set(),visited=new Set();function visit(id){if(visiting.has(id)){err(id,'dependency cycle');return;}if(visited.has(id))return;visiting.add(id);for(const d of by.get(id)?.dependsOn||[])if(by.has(d))visit(d);visiting.delete(id);visited.add(id);}for(const id of ids)visit(id);
 const allowed={M0:['contracts'],M1:['world','observed'],M2:['proposals'],M3:['commitments','orders','ownership'],M4:['capacity','tasks'],M5:['ledger','reserves','inventoryCost'],M6:['policy','appeals'],M7:['reports']};
 const reads={M0:[],M1:['contracts'],M2:['observed','policy','contracts'],M3:['proposals','policy','capacity','ledgerProjection'],M4:['commitments','policy'],M5:['businessEvents','policy'],M6:['authorizedEvidence'],M7:['world','observed','businessEvents','ledgerProjection']};
 const mid=new Set();for(const m of w.modules||[]){if(mid.has(m.id)||!allowed[m.id])err('modules',`unknown/duplicate ${m.id}`);mid.add(m.id);for(const wr of m.writes||[])if(!allowed[m.id]?.includes(wr))err(m.id,`forbidden write ${wr}`);for(const r of m.reads||[])if(!reads[m.id]?.includes(r))err(m.id,`forbidden read ${r}`);}for(const id of Object.keys(allowed))if(!mid.has(id))err('modules',`missing ${id}`);
 const routes=new Set();for(const s of w.surfaces||[]){if(routes.has(s.route))err('surfaces','duplicate route');routes.add(s.route);if(s.directWrites?.length)err(s.route,'surface may not directly write domain state');if(s.route!=='/'&&s.commandBoundary!=='application_coordinator')err(s.route,'commands must enter application coordinator');}for(const p of ['/','/live','/ops','/partners','/lab'])if(!routes.has(p))err('surfaces',`missing ${p}`);
 for(const f of w.fixtureRefs||[])if(!ref(f))err('fixtures',`missing or unsafe reference ${f}`);
 if(observed){if(observed.currency!=='CNY'||observed.moneyUnit!=='minor'||!Number.isInteger(observed.asOfTick))err('observed','unit/clock missing');const walk=(x,p)=>{if(!x||typeof x!=='object')return;for(const [k,v] of Object.entries(x)){if(['world','futureActualDepartures','futureCancellations','futureActualSalePrice'].includes(k))err(p+'.'+k,'hidden future forbidden');if(k==='observedAtTick'&&(!Number.isInteger(v)||v>observed.asOfTick))err(p+'.'+k,'not yet observed');if(k.endsWith('Minor')&&(!Number.isInteger(v)||v<0))err(p+'.'+k,'nonnegative integer minor currency required');walk(v,p+'.'+k);}};walk(observed,'observed');}
 return {ok:errors.length===0,errors,ready:tasks.filter(t=>t.status==='queued'&&(t.dependsOn||[]).every(d=>by.get(d)?.status==='accepted')).map(t=>({id:t.id,title:t.title,owner:t.owner,reviewer:t.reviewer}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const w=JSON.parse(readFileSync('workflow/v2.json','utf8')),observed=JSON.parse(readFileSync('workflow/fixtures/observed.json','utf8')),r=validate(w,{observed});
 console.log(JSON.stringify(process.argv.includes('--ready')?{ok:r.ok,errors:r.errors,ready:r.ready}:r,null,2));process.exitCode=r.ok?0:1;
}
