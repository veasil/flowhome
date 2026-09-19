/** Flowhome v1 — deterministic, illustrative weekly city simulation. No live data. */
export const DISTRICTS=['徐家汇','龙华','漕河泾'];
export const CATEGORIES=['净水设备','办公椅','床垫'];
export const STRATEGIES={B0:'事后交易',B1:'提前匹配',B2:'预测协调'};
export const DEFAULT={seed:42,strategy:'B2',scenario:'normal',tenure:12,category:0,newOnly:true,budget:2200,capacity:1,capital:60000,uptake:.65,bias:0,cancel:false,supply:1,sku:null};
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function rand(seed,stream,id,t=0){let h=2166136261;for(const c of `${seed}|${stream}|${id}|${t}`){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,2246822507);h^=h>>>13;return (h>>>0)/4294967296;}
export function generate(seed=42,overrides={}){
 const cfg={...DEFAULT,...overrides,seed};
 const skus=Array.from({length:30},(_,i)=>{const cat=Math.floor(i/10),j=i%10;return {id:i,cat,name:`${['清泉','坐标','好眠'][cat]} ${['轻享','日常','舒适','优选','长青'][Math.floor(j/2)]}${j%2?' Pro':''}`,price:[850,650,1200][cat]+j*[145,125,180][cat],quality:j,repairable:j%3!==0,maintenance:[80,15,0][cat],handling:[170,110,340][cat],life:[260,416,364][cat],size:j%2?'标准':'紧凑'};});
 const residents=Array.from({length:1000},(_,id)=>{const arrival=Math.floor(rand(seed,'arrival',id)*78),tenure=12+Math.floor(rand(seed,'tenure',id)*53);return {id,name:id===0?'小栖':`居民 ${String(id).padStart(4,'0')}`,district:Math.floor(rand(seed,'district',id)*3),cat:id%3,arrival,tenure,budget:700+Math.floor(rand(seed,'budget',id)*2300),newOnly:rand(seed,'newOnly',id)<.28,minQuality:Math.floor(rand(seed,'quality',id)*5),member:rand(seed,'member',id)>.48,x:rand(seed,'x',id),y:rand(seed,'y',id)};});
 Object.assign(residents[0],{district:0,cat:cfg.category,arrival:0,tenure:Math.round(cfg.tenure*4.333),budget:cfg.budget,newOnly:cfg.newOnly,minQuality:2,member:false});
 Object.assign(residents[1],{preferredAsset:'new-0',district:0,cat:cfg.category,arrival:residents[0].tenure+3,tenure:26,budget:2600,newOnly:false,minQuality:0});
 Object.assign(residents[2],{preferredAsset:'new-0',district:0,cat:cfg.category,arrival:residents[0].tenure+9,tenure:26,budget:2600,newOnly:false,minQuality:0});
 const assets=Array.from({length:600},(_,i)=>{const sku=skus[(i%3)*10+Math.floor(rand(seed,'sku',i)*10)];return {id:`a-${i}`,sku:sku.id,cat:sku.cat,district:Math.floor(rand(seed,'assetDistrict',i)*3),owner:`r-${i}`,user:`r-${i}`,condition:.65+rand(seed,'condition',i)*.3,state:'in_use',release:Math.floor(rand(seed,'release',i)*88),available:0,book:0,reserved:null,cycles:0,x:rand(seed,'assetx',i),y:rand(seed,'assety',i),created:-30};});
 const providers=Array.from({length:8},(_,i)=>({id:`p-${i}`,name:['清泉维护站','邻里检测社','轻搬合作组','坐标修理铺','徐汇服务站','龙华协作点','漕河泾工作坊','城市互助小队'][i],district:i%3,capacity:5+i%3,skills:i%3===0?'检测 · 安装':'检测 · 搬运'}));
 return {residents,assets,skus,providers};
}
export function forecast(observed,bias=0){
 // Only current inventory, disclosed intentions and occurred demand history enter this function.
 const demand=Array.from({length:3},()=>[0,0,0]),supply=Array.from({length:3},()=>[0,0,0]);
 for(let d=0;d<3;d++)for(let c=0;c<3;c++){
  const recent=observed.history.filter(x=>x.week>=observed.week-8&&x.district===d&&x.cat===c).length;
  demand[d][c]=Math.max(.1,(recent*.7+2.6)*(1+bias));
  supply[d][c]=observed.assets.filter(a=>a.district===d&&a.cat===c&&a.cat!==2&&(a.state==='available'||(a.disclosedRelease!==null&&a.disclosedRelease<=observed.week+8))).length;
 }
 return {demand,supply,window:8,asOf:observed.week};
}
export function quote(sku,person,fc){
 const pressure=clamp((fc.demand[person.district][sku.cat]+2)/(fc.supply[person.district][sku.cat]+2),.25,2);
 const retention=clamp(.75-person.tenure/sku.life*.7,.2,.72);
 const resale=Math.round(sku.price*retention*(sku.repairable?1.08:.70)*clamp(Math.pow(pressure,.16),.72,1.12));
 const guarantee=sku.cat===2?0:Math.max(0,Math.floor((resale*.80-sku.handling-70)/10)*10);
 return {resale,guarantee,pressure,fee:120,handling:sku.handling,expectedCost:sku.price+(guarantee>0?120:0)+Math.floor(Math.max(0,person.tenure-1)/26)*Math.round(sku.maintenance/2)-guarantee};
}
export function runSimulation(input={}){
 const cfg={...DEFAULT,...input},city=generate(cfg.seed,cfg),{residents,assets,skus,providers}=city;
 const world={departures:residents.map(r=>r.arrival+r.tenure),cancellations:residents.map(r=>rand(cfg.seed,'cancel',r.id)<.035)};
 if(cfg.scenario==='departures')world.departures=world.departures.map((w,i)=>i>2&&residents[i].arrival<=40&&w>40&&rand(cfg.seed,'leaveShock',i)<.34?40+Math.floor(rand(cfg.seed,'leaveWeek',i)*8):w);
 if(input.futureOverride)for(const [id,w] of Object.entries(input.futureOverride))world.departures[Number(id)]=w;
 const demands=[],contracts=[],events=[],ledger=[],snapshots=[],history=[],plans=[];
 let cash=cfg.capital,reservedCash=0,revenue=0,serviceCosts=0,cogs=0,fixedCosts=0,unpaidCosts=0,wages=0,defaults=0,breaches=0,providerBreaches=0,mainQuotes=[],mainChosen=null;
 let ledgerID=0,eventID=0;const slots=new Map();
 function event(week,type,detail,asset=null,resident=null){const e={id:`e-${++eventID}`,week,type,detail,asset,resident};events.push(e);return e.id;}
 function transfer(week,from,to,amount,kind,asset=null,resident=null){amount=Math.round(amount);if(amount<=0)return true;if(from==='platform'&&cash<amount){defaults++;event(week,'未付款项',`${kind}尚欠 ¥${amount}`,asset,resident);return false;}if(from==='platform')cash-=amount;if(to==='platform')cash+=amount;ledger.push({id:`j-${++ledgerID}`,week,from,to,amount,kind,asset,resident});return true;}
 function cap(p,w){let mult=cfg.capacity;if(cfg.scenario==='capacity'&&w>=40&&w<52)mult*=.5;return Math.max(0,Math.floor(p.capacity*mult));}
 function allocate(district,earliest,count=1,maxWait=3){
  for(let w=earliest;w<=earliest+maxWait;w++)for(const p of providers.filter(p=>p.district===district)){
   const key=`${p.id}:${w}`,used=slots.get(key)||0;if(used+count<=cap(p,w)){slots.set(key,used+count);return {provider:p.id,week:w,count};}
  }return null;
 }
 function observe(week){return {week,history:history.slice(),assets:assets.map(a=>({cat:a.cat,district:a.district,state:a.state,disclosedRelease:a.state==='in_use'&&a.release<=week+4?a.release:null}))};}
 function sellerRelease(a,w){a.user=null;a.state=a.reserved?'reserved':'available';a.available=w;a.release=999;event(w,'物件释放',`${skus[a.sku].name}进入待匹配`,a.id);}
 const endWeek=input.endWeek??103;
 for(let week=0;week<=endWeek;week++){
  // Reveal departures only now; latent future never enters forecast or matching.
  for(const a of assets){if(a.state==='in_use'){
   let actual=a.release;if(a.lastResident!=null)actual=world.departures[a.lastResident];
   if(actual<=week){const con=contracts.find(c=>c.asset===a.id&&c.status==='active');
    if(con){const paid=transfer(week,'platform',a.owner,con.guarantee,'承诺回购',a.id,a.lastResident);if(paid){reservedCash-=con.guarantee;con.status='returned';con.returnedWeek=week;a.book=con.guarantee;a.owner='platform';a.user=null;a.state='inspection';const task=allocate(a.district,week+1,1,8);a.available=task?task.week+1:week+10;con.task=task;if(task){if(transfer(week,'platform',task.provider,con.handling,'检测与取件',a.id)){reservedCash-=con.handling;serviceCosts+=con.handling;wages+=con.handling;}else{a.available=999;a.pendingHandling=con.handling;}}else{a.available=999;a.pendingHandling=con.handling;event(week,'履约受阻','已回购，等待检测运力',a.id);}event(week,'承诺兑现',`回购 ¥${con.guarantee}；检测后可再次使用`,a.id,a.lastResident);
    }}else sellerRelease(a,week);
   }
  }}
  // Week-40 shock adds released assets from existing inventory, not invented new stock.
  if(cfg.supply>1&&week===40)for(const a of assets.filter(a=>a.created<0&&a.state==='in_use').slice(0,Math.round((cfg.supply-1)*100)))sellerRelease(a,week);
  for(const a of assets)if(a.pendingHandling){const task=allocate(a.district,week+1,1,0);if(task&&transfer(week,'platform',task.provider,a.pendingHandling,'补排检测取件',a.id)){reservedCash-=a.pendingHandling;serviceCosts+=a.pendingHandling;wages+=a.pendingHandling;a.pendingHandling=0;a.available=task.week+1;event(week,'服务重新排定',`第 ${task.week} 周检测`,a.id);}}
  for(const a of assets)if(a.state==='inspection'&&a.available<=week){a.state='available';event(week,'检测完成','完成检查与必要整备',a.id);}
  // Complete shipments. The buyer owns the asset only on delivery.
  for(const p of plans.filter(p=>!p.completed&&p.delivery===week)){
   const a=assets.find(a=>a.id===p.asset),d=demands.find(d=>d.id===p.demand),r=residents[d.resident];
   if(!['available','reserved'].includes(a.state)||a.available>week||a.reserved!==d.id){p.completed=true;p.outcome='unready';d.status='open';a.reserved=null;event(week,'交接未就绪','物件尚未释放，取消原预约并重新匹配',a.id,r.id);continue;}
   if(r.id>2&&rand(cfg.seed,'providerFailure',p.provider,week)<.025){p.completed=true;p.outcome='provider_failed';d.status='open';a.state='available';a.reserved=null;providerBreaches++;event(week,'服务方失约',`${p.provider}未能完成预约，重新匹配；不记入用户违约`,a.id,r.id);continue;}
   const canceled=(world.cancellations[r.id]&&r.id!==0)||(cfg.cancel&&r.id===1);
   if(canceled){a.state='available';a.reserved=null;a.available=week;p.completed=true;p.outcome='canceled';d.status='canceled';breaches++;event(week,'已约订单取消','付款前取消；物件回到可用库存',a.id,r.id);continue;}
   const seller=a.owner;transfer(week,`r-${r.id}`,seller,p.price,'二手物件交易',a.id,r.id);
   if(seller==='platform'){revenue+=p.price;cogs+=a.book;a.book=0;}
   transfer(week,`r-${r.id}`,'platform',p.fee,'协调服务费',a.id,r.id);revenue+=p.fee;
   transfer(week,`r-${r.id}`,p.provider,p.handling,'交付服务',a.id,r.id);wages+=p.handling;
   d.paid=p.price+p.fee+p.handling;d.status='fulfilled';d.fulfilled=week;d.asset=a.id;d.used=true;
   a.owner=`r-${r.id}`;a.user=a.owner;a.lastResident=r.id;a.usedSince=week;a.release=r.arrival+r.tenure;a.state='in_use';a.reserved=null;a.condition=Math.max(.4,a.condition-.03);a.cycles++;p.completed=true;p.outcome='delivered';p.actualDelivery=week;
   event(week,'再次入住',`${r.name}接到 ${skus[a.sku].name}`,a.id,r.id);
  }
  // New demand becomes public only upon arrival.
  for(const r of residents.filter(r=>r.arrival===week)){
   if(cfg.scenario==='demand'&&week>=40&&week<64&&r.id>2&&rand(cfg.seed,'demandShock',r.id)<.4)continue;
   demands.push({id:`d-${r.id}`,resident:r.id,week,deadline:week+3,status:'open',district:r.district,cat:r.cat,budgetGroup:r.budget<1400?'有限预算':'较高预算',tenureGroup:r.tenure<=30?'短住 ≤7月':'长住 >7月',memberGroup:r.member?'已有记录':'新成员',paid:0});history.push({week,district:r.district,cat:r.cat});
  }
  const fc=forecast(observe(week),cfg.bias);
  for(const d of demands.filter(d=>d.status==='open').sort((a,b)=>a.deadline-b.deadline||a.resident-b.resident)){
   const r=residents[d.resident];
   // This prototype uses inspection rather than a demographic trust score.
   const compatible=assets.filter(a=>(!r.preferredAsset||a.id===r.preferredAsset)&&a.cat===r.cat&&a.cat!==2&&!r.newOnly&&a.condition>=.65&&skus[a.sku].quality>=r.minQuality&&a.district===r.district&&!a.reserved&&(!a.blockedUntil||a.blockedUntil<=week)&&(a.state==='available'||(cfg.strategy!=='B0'&&a.state==='in_use'&&a.release<=week+2&&a.release>week)));
   if(r.id===0&&!mainQuotes.length){mainQuotes=skus.filter(s=>s.cat===r.cat&&s.quality>=r.minQuality&&s.price<=r.budget).map(s=>({sku:s,...quote(s,r,fc)}));}
   const options=compatible.map(a=>({a,price:Math.round(skus[a.sku].price*a.condition*.58*Math.max(.65,1-Math.max(0,a.state==='available'?week-a.available:0)*.006)),ready:a.state==='available'?week:a.release})).filter(o=>o.price+skus[o.a.sku].handling+65<=r.budget).sort((a,b)=>a.price-b.price);
   if(options.length&&(r.id!==0||cfg.sku==null)){const o=options[0],task=allocate(r.district,Math.max(week,o.ready)+1,1,0);if(task&&task.week+1<=d.deadline){o.a.reserved=d.id;if(o.a.state==='available')o.a.state='reserved';plans.push({asset:o.a.id,demand:d.id,delivery:task.week+1,price:o.price,fee:65,handling:skus[o.a.sku].handling,provider:task.provider,completed:false});d.status='scheduled';if(r.id===0){mainChosen={sku:skus[o.a.sku],guarantee:0,signed:false,used:true,asset:o.a.id,expectedCost:o.price+65+skus[o.a.sku].handling+Math.floor(Math.max(0,r.arrival+r.tenure-task.week-2)/26)*Math.round(skus[o.a.sku].maintenance/2),reason:'选择现有物件，检测交付后使用；本次二手方案不承诺再次回购'};}event(week,'交接预约',`预约第 ${task.week+1} 周交付`,o.a.id,r.id);continue;}else if(task)slots.set(`${task.provider}:${task.week}`,(slots.get(`${task.provider}:${task.week}`)||0)-1);}
   const anticipatedExit=r.arrival+r.tenure;
   const futureCapacity=providers.filter(p=>p.district===r.district).reduce((n,p)=>n+Math.max(0,cap(p,anticipatedExit+1)-(slots.get(`${p.id}:${anticipatedExit+1}`)||0)),0);
   const sameWindow=contracts.filter(c=>c.status==='active'&&c.district===r.district&&Math.abs(c.exit-anticipatedExit)<=1).length;
   const candidates=skus.filter(s=>s.cat===r.cat&&s.quality>=r.minQuality&&s.price<=r.budget).map(s=>{const q=quote(s,r,fc);const canGuarantee=cfg.strategy==='B2'&&q.guarantee>0&&r.budget>=s.price+120&&cash-reservedCash-2000>=q.guarantee+q.handling&&sameWindow<futureCapacity;return {sku:s,...q,canGuarantee,candidateExpectedCost:q.expectedCost,expectedCost:s.price+(canGuarantee?120-q.guarantee:0)+Math.floor(Math.max(0,r.tenure-1)/26)*Math.round(s.maintenance/2)};});
   candidates.sort((a,b)=>cfg.strategy==='B2'?a.expectedCost-b.expectedCost:a.sku.price-b.sku.price);
   if(!candidates.length){if(week>=d.deadline){d.status='unmet';event(week,'需求未满足','预算或硬条件下没有可用方案',null,r.id);}continue;}
   if(r.id!==0&&week<d.deadline&&rand(cfg.seed,'wait',r.id,week)<.35)continue;
   let choice=candidates[0];if(cfg.strategy==='B2'&&r.id!==0&&rand(cfg.seed,'uptake',r.id)>cfg.uptake)choice=[...candidates].sort((a,b)=>a.sku.price-b.sku.price)[0];
   if(r.id===0){mainQuotes=candidates.map(c=>({...c,eligible:c.guarantee>0,affordable:c.sku.price+120<=r.budget}));if(cfg.sku!=null)choice=candidates.find(c=>c.sku.id===cfg.sku)||choice;}
   const s=choice.sku,reserve=choice.guarantee+choice.handling;
   const guarantee=choice.canGuarantee;
   const asset={id:`new-${r.id}`,sku:s.id,cat:s.cat,district:r.district,owner:`r-${r.id}`,user:`r-${r.id}`,lastResident:r.id,condition:1,state:'in_use',release:anticipatedExit,available:999,book:0,reserved:null,cycles:0,x:r.x,y:r.y,created:week,usedSince:week};assets.push(asset);
   transfer(week,`r-${r.id}`,'retailer',s.price,'购入新品',asset.id,r.id);d.paid=s.price;d.status='fulfilled';d.fulfilled=week;d.asset=asset.id;d.used=false;
   if(guarantee){reservedCash+=reserve;contracts.push({id:`c-${r.id}`,asset:asset.id,resident:r.id,district:r.district,signedWeek:week,exit:anticipatedExit,guarantee:choice.guarantee,handling:choice.handling,reserve,status:'active',fee:120});transfer(week,`r-${r.id}`,'platform',120,'退出服务费',asset.id,r.id);revenue+=120;d.paid+=120;}
   if(r.id===0)mainChosen={...choice,expectedCost:choice.sku.price+(guarantee?120:0)+Math.floor(Math.max(0,r.tenure-1)/26)*Math.round(choice.sku.maintenance/2)-(guarantee?choice.guarantee:0),guarantee:guarantee?choice.guarantee:0,signed:guarantee,reason:s.cat===2?'床垫缺少可验证的卫生处理，本原型不承诺回购':!guarantee?'资金、服务容量或价格条件不足，选择自主持有':'符合回购条件，资金已留存，价格已确认',asset:asset.id};
   event(week,'生活安顿',`${r.name}购入 ${s.name}${guarantee?'，退出安排已确认':'，自主持有'}`,asset.id,r.id);
  }
  // Apply wear only to active usage. Maintenance generates real payments at annual intervals.
  for(const a of assets){if(a.state==='in_use')a.condition=Math.max(.4,a.condition-.001);if(a.lastResident!=null&&week>a.usedSince&&(week-a.usedSince)%26===0&&a.state==='in_use'&&skus[a.sku].maintenance>0){transfer(week,a.owner,'maintenance',Math.round(skus[a.sku].maintenance/2),'使用期耗材',a.id,a.lastResident);}}
  const available=assets.filter(a=>a.state==='available'),platformInventory=assets.filter(a=>a.owner==='platform');
  let holding=platformInventory.filter(a=>a.state==='available').length*3;
  fixedCosts+=holding+45;unpaidCosts+=holding+45;const payable=Math.min(unpaidCosts,Math.max(0,cash-reservedCash));if(payable>0){transfer(week,'platform','operations',payable,'仓储与固定运营');unpaidCosts-=payable;}if(unpaidCosts>0){event(week,'运营缓冲不足',`累计运营应付款 ¥${unpaidCosts}`);defaults++;}
  const due=demands.filter(d=>d.deadline<=week),satisfied=due.filter(d=>d.status==='fulfilled'&&d.fulfilled<=d.deadline);
  const inv=platformInventory.reduce((n,a)=>n+Math.round(skus[a.sku].price*a.condition*.55),0);
  const residentNet=new Map();for(const l of ledger){if(l.from.startsWith('r-'))residentNet.set(Number(l.from.slice(2)),(residentNet.get(Number(l.from.slice(2)))||0)+l.amount);if(l.to.startsWith('r-'))residentNet.set(Number(l.to.slice(2)),(residentNet.get(Number(l.to.slice(2)))||0)-l.amount);}
  const groups=['有限预算','较高预算','短住 ≤7月','长住 >7月','新成员','已有记录'].map(name=>{const ds=due.filter(d=>[d.budgetGroup,d.tenureGroup,d.memberGroup].includes(name));const served=ds.filter(d=>d.status==='fulfilled'&&d.fulfilled<=d.deadline);return {name,total:ds.length,served:served.length,rate:ds.length?served.length/ds.length:0,cost:served.length?Math.round(served.reduce((n,d)=>n+d.paid,0)/served.length):0,netCost:served.length?Math.round(served.reduce((n,d)=>n+(residentNet.get(d.resident)||0),0)/served.length):0};});
  const itemNet=new Map();for(const l of ledger){if(!l.asset)continue;if(l.from.startsWith('r-')){const key=l.from+':'+l.asset;itemNet.set(key,(itemNet.get(key)||0)+l.amount)}if(l.to.startsWith('r-')){const key=l.to+':'+l.asset;itemNet.set(key,(itemNet.get(key)||0)-l.amount)}}const servedItems=demands.filter(d=>d.status==='fulfilled'),cashPaid=servedItems.reduce((n,d)=>n+(itemNet.get('r-'+d.resident+':'+d.asset)||0),0),cashReceived=0;
  const duePlans=plans.filter(p=>p.delivery<=week),completed=duePlans.filter(p=>p.outcome==='delivered'&&p.actualDelivery<=p.delivery);
  const purchased=assets.filter(a=>a.created>=0&&a.created<=week),skuCounts=skus.map(s=>({sku:s.id,name:s.name,count:purchased.filter(a=>a.sku===s.id).length})).sort((a,b)=>b.count-a.count);const concentration={newPurchases:purchased.length,topSku:skuCounts[0]?.name,topCount:skuCounts[0]?.count||0,topShare:purchased.length?(skuCounts[0]?.count||0)/purchased.length:0,skuCounts};
  snapshots.push({week,concentration,cash,unpaidCosts,reserved:reservedCash,freeCash:cash-reservedCash,inventory:platformInventory.length,inventoryValue:inv,available:available.length,active:residents.filter(r=>r.arrival<=week&&world.departures[r.id]>week).length,demand:due.length,served:satisfied.length,rate:due.length?satisfied.length/due.length:0,transfers:completed.length,obligations:duePlans.length,onTime:duePlans.length?completed.length/duePlans.length:1,contribution:revenue-serviceCosts-cogs,result:revenue-serviceCosts-cogs-fixedCosts,wages,netCost:cashPaid-cashReceived,averageCost:due.length?Math.round((cashPaid-cashReceived)/Math.max(1,demands.filter(d=>d.status==='fulfilled').length)):0,idleWeeks:(snapshots.at(-1)?.idleWeeks||0)+available.length,defaults,breaches,providerBreaches,groups,fc,districts:DISTRICTS.map((name,i)=>({name,available:available.filter(a=>a.district===i).length,needs:demands.filter(d=>d.district===i&&['open','scheduled'].includes(d.status)).length,active:residents.filter(r=>r.district===i&&r.arrival<=week&&world.departures[r.id]>week).length})),points:assets.filter(a=>['available','reserved','inspection'].includes(a.state)).map(a=>({id:a.id,x:a.x,y:a.y,district:a.district,cat:a.cat,state:a.state,sku:a.sku}))});
 }
 const mainAsset=mainChosen?.asset||'new-0';const mainLedger=ledger.filter(l=>l.asset===mainAsset),mainEvents=events.filter(e=>e.asset===mainAsset||e.resident===0);
 return {config:cfg,...city,demands,contracts,events,ledger,snapshots,plans,main:{quotes:mainQuotes,choice:mainChosen,ledger:mainLedger,events:mainEvents,asset:assets.find(a=>a.id===mainAsset)},summary:snapshots.at(-1),slots:[...slots].map(([key,count])=>({key,count})),assumptions:{forecast:'过去8周需求＋公开意向；先验2.6；运力下降为预先公告的排程约束，需求与离城冲击发生时揭示',cash:'足额留存回购与处理款；服务收入与现金分别记账',scope:'新品零售交付假定由商家承担；本地容量约束适用于循环服务',pricing:'全部价格、行为概率与空间位置为模拟假设'}};
}
export function summarizeBatch(results){return ['normal','departures','demand','capacity'].flatMap(scenario=>['B0','B1','B2'].map(strategy=>{const rs=results.filter(r=>r.config.strategy===strategy&&r.config.scenario===scenario);if(!rs.length)return null;const metric=k=>({mean:rs.reduce((n,r)=>n+r.summary[k],0)/rs.length,min:Math.min(...rs.map(r=>r.summary[k])),max:Math.max(...rs.map(r=>r.summary[k]))});return {scenario,strategy,runs:rs.length,rate:metric('rate'),cost:metric('averageCost'),transfers:metric('transfers'),cash:metric('cash'),result:metric('result'),idle:metric('idleWeeks')};})).filter(Boolean);}
