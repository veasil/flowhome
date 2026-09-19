import {runCity,runExperiment} from './index.mjs';
self.onmessage=async({data})=>{try{if(data.kind==='experiment'){const report=await runExperiment(data.config,p=>self.postMessage({kind:'progress',...p}));self.postMessage({kind:'report',report});}else self.postMessage({kind:'city',city:runCity(data.config)});}catch(e){self.postMessage({kind:'error',message:String(e.message||e)})}};
