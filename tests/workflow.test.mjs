import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {validate} from '../scripts/check-v2-workflow.mjs';
const roots=[];after(()=>{for(const r of roots)rmSync(r,{recursive:true,force:true});});
const raw=()=>({w:JSON.parse(readFileSync('workflow/v2.json','utf8')),o:JSON.parse(readFileSync('workflow/fixtures/observed.json','utf8'))});
// Test-only accepted review specimen; never changes the real task registry or real review.
function load(){const {w,o}=raw(),root=mkdtempSync(join(tmpdir(),'flowhome-workflow-test-'));roots.push(root);const refs=new Set(w.fixtureRefs);for(const t of w.tasks)for(const f of [...t.inputRefs,...t.outputs,...t.evidenceRefs,...t.reviewEvidenceRefs])refs.add(f);for(const f of refs){mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),readFileSync(f));}const c=w.tasks[0];c.status='accepted';c.reviewDecision='accept';c.reviewEvidenceRefs=['test-review.json'];const inputHashes=Object.fromEntries(c.inputRefs.map(f=>[f,createHash('sha256').update(readFileSync(join(root,f))).digest('hex')]));writeFileSync(join(root,'test-review.json'),JSON.stringify({taskId:c.id,reviewer:c.reviewer,decision:'accept',reviewedAt:'synthetic-test-only',inputHashes}));w.__testRoot=root;return {w,o};}
const check=(w,o)=>validate(w,{root:w.__testRoot,observed:o});
test('待审基线不解锁下游',()=>{const {w,o}=load();w.tasks[0].status='review';w.tasks[0].reviewDecision='pending';const r=check(w,o);assert.deepEqual(r.errors,[]);assert.equal(r.ready.length,0);});
test('合法独立审阅登记后输出7个可并行工作包',()=>{const {w,o}=load(),r=check(w,o);assert.deepEqual(r.errors,[]);assert.equal(r.ready.length,7);});
for(const [name,mutate,expected] of [
 ['依赖环',w=>w.tasks[0].dependsOn=['I1'],'cycle'],
 ['自审',w=>w.tasks[0].reviewer=w.tasks[0].owner,'distinct'],
 ['缺审阅证据',w=>w.tasks[0].evidenceRefs=[],'evidence'],
 ['缺独立审查产物',w=>w.tasks[0].reviewEvidenceRefs=[],'review evidence'],
 ['审查者不对应',w=>w.tasks[0].reviewer='different-reviewer','review identity'],
 ['算法写现金',w=>w.modules.find(m=>m.id==='M2').writes.push('ledger'),'forbidden write'],
 ['算法读取隐藏世界',w=>w.modules.find(m=>m.id==='M2').reads.push('world'),'forbidden read'],
 ['履约读取原始账本',w=>w.modules.find(m=>m.id==='M4').reads.push('ledger'),'forbidden read'],
 ['UI直接写状态',w=>w.surfaces[0].directWrites=['commitments'],'directly write'],
 ['未知依赖',w=>w.tasks[1].dependsOn=['missing'],'missing dependency']
])test(name,()=>{const {w,o}=load();mutate(w);assert.ok(check(w,o).errors.some(e=>e.includes(expected)));});
for(const [name,mutate,expected] of [
 ['隐藏未来',o=>o.futureCancellations=[1],'hidden future'],
 ['尚未公开的信息',o=>o.publicInventory[0].observedAtTick=1,'not yet observed'],
 ['金额单位',o=>o.publicInventory[0].priceMinor=1.5,'integer minor']
])test(name,()=>{const {w,o}=load();mutate(o);assert.ok(check(w,o).errors.some(e=>e.includes(expected)));});
test('审阅输入变化后旧审阅失效',()=>{const {w,o}=load();writeFileSync(join(w.__testRoot,w.tasks[0].inputRefs[0]),'changed');assert.ok(check(w,o).errors.some(e=>e.includes('stale review input')));});
test('真实实验必须等待集成并提交三类证据',()=>{const {w,o}=load(),t=w.tasks.find(t=>t.id==='E1b');t.status='accepted';const r=check(w,o);assert.ok(r.errors.some(e=>e.includes('dependency I1 not accepted')));assert.ok(r.errors.some(e=>e.includes('required evidence missing: run_artifact')));});
