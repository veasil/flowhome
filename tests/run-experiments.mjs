import {runSimulation,summarizeBatch,DEFAULT} from '../lib/flowhome/engine.mjs';
import {writeFileSync} from 'node:fs';
const rows=[],sensitivity=[],benchmark=[];
const compact=r=>({config:r.config,summary:{...r.summary,points:undefined,fc:undefined,districts:undefined},contracts:r.contracts.length});
for(const scenario of ['normal','departures','demand','capacity'])for(let seed=101;seed<=110;seed++)for(const strategy of ['B0','B1','B2']){rows.push(compact(runSimulation({...DEFAULT,seed,scenario,strategy})));if(rows.length%30===0)console.log(`Primary ${rows.length}/120`);}
for(const uptake of [.3,.6,.9])for(const bias of [-.3,0,.3])for(let seed=101;seed<=110;seed++)sensitivity.push(compact(runSimulation({...DEFAULT,seed,uptake,bias})));
for(let i=0;i<10;i++){const t=performance.now();for(const strategy of ['B0','B1','B2'])runSimulation({...DEFAULT,strategy,seed:101+i});benchmark.push(Math.round(performance.now()-t));}
const sensitivitySummary=[.3,.6,.9].flatMap(uptake=>[-.3,0,.3].map(bias=>{const rs=sensitivity.filter(r=>r.config.uptake===uptake&&r.config.bias===bias);return {uptake,bias,...summarizeBatch(rs)[0]}}));
const report={version:1,generatedAt:new Date().toISOString(),disclaimer:'Synthetic experiment, not real-market evidence. Paired strategy bundles; no isolated causal AI effect.',config:DEFAULT,rows,summary:summarizeBatch(rows),sensitivity,sensitivitySummary,benchmark:{environment:'Node local runtime; separate browser validation recorded in acceptance report',threeStrategiesMs:benchmark}};
writeFileSync('public/downloads/experiment-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({summary:report.summary,sensitivity:sensitivitySummary,benchmark},null,2));
