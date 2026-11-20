import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {TaskJournal} from '../task-journal.js';
import {loadProjectMemory,projectMemoryView,projectMemorySource} from '../project-memory.js';

const uuid=()=>crypto.randomUUID();
const sum=text=>crypto.createHash('sha256').update(text).digest('hex');
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-project-memory-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=new TaskJournal(dir);await journal.init();return {dir,journal}}
async function run(journal,{workspace='/repo',profile='coding',decisions=[],writes=[],finish=true}={}){
 const id=uuid();await journal.append(id,{kind:'start',journal_version:1,task:'old task containing sensitive private content',workspace,profile});let n=0;
 for(const text of decisions)await journal.append(id,{kind:'event',event:{id:++n,type:'architecture_decision',text}});
 for(const file of writes)await journal.append(id,{kind:'event',event:{id:++n,type:'tool_result',name:'write_file',text:'private file content must not be retrieved',outcome:{status:'success',verified_hash:sum(file.content)},memory_source:{scope:'shadow_text_files',basis:'verified_write',path:file.path}}});
 if(finish){await journal.append(id,{kind:'event',event:{id:++n,type:'done'}});await journal.append(id,{kind:'event',event:{id:++n,type:'finished'}})}await journal.flush();return id;
}
test('project memory scopes intact completed journals and exposes no raw output',async t=>{
 const {dir,journal}=await fixture(t),good=await run(journal,{decisions:['Authentication uses session cookies','api_key=private-secret'],writes:[{path:'src/auth.js',content:'a'},{path:'.env',content:'secret'}]});
 await run(journal,{workspace:'/other',decisions:['authentication in other workspace']});await run(journal,{profile:'trading',decisions:['authentication trading']});await run(journal,{decisions:['authentication unfinished'],finish:false});
 const invalid=uuid();await writeFile(path.join(dir,invalid+'.jsonl'),'{broken');const linked=uuid();await symlink(journal.file(good),journal.file(linked));
 assert.equal(await journal.read(linked,{maxBytes:1024*1024}),null);
 const archive=await loadProjectMemory({journal,workspace:'/repo',profile:'coding'});
 assert.deepEqual(archive.runs,[good]);assert.equal(archive.records.length,2);
 const serialized=JSON.stringify(archive);assert.doesNotMatch(serialized,/private file content|private-secret|old task|\.env|other workspace|trading|unfinished/);
 assert.equal(projectMemorySource(archive,{run_id:good,event_id:1}).trust,'model_interpretation');
 assert.equal(projectMemorySource(archive,{run_id:linked,event_id:1}),null);
});
test('hash match only describes a single tracked file at a specific snapshot',async t=>{
 const {journal}=await fixture(t),id=await run(journal,{decisions:['Authentication session uses cookies'],writes:[{path:'src/auth.js',content:'old'}]});
 const archive=await loadProjectMemory({journal,workspace:'/repo',profile:'coding'});
 const shadow={hashFileAtTree:async(file,tree)=>{assert.equal(file,'src/auth.js');assert.equal(tree,'tree-one');return sum('old')}};
 const view=await projectMemoryView({archive,task:'change authentication auth',shadow,tree:'tree-one'});
 assert.equal(view.items.length,2);assert.equal(view.items.find(x=>x.kind==='decision').freshness,'unknown');assert.equal(view.items.find(x=>x.kind==='verified_write').freshness,'matches_snapshot');
 assert.match(view.notice,/Earlier tests and environment are not verified/);
 const changed=await projectMemoryView({archive,task:'auth',shadow:{hashFileAtTree:async()=>sum('new')},tree:'new-tree'});assert.equal(changed.items.find(x=>x.kind==='verified_write').freshness,'changed');
 const unknown=await projectMemoryView({archive,task:'auth',shadow:{hashFileAtTree:async()=>null},tree:'new-tree'});assert.equal(unknown.items.find(x=>x.kind==='verified_write').freshness,'unknown');
 assert.equal(projectMemorySource(archive,{run_id:id,event_id:2}).freshness,'unknown');
 assert.deepEqual((await projectMemoryView({archive,task:'unrelated elephant'})).items,[]);
});
test('limits and excluded runs prevent unbounded or unwanted journal exposure',async t=>{
 const {dir,journal}=await fixture(t);const excluded=await run(journal,{decisions:['backend route']});await run(journal,{decisions:['backend schema']});
 const large=uuid();await writeFile(journal.file(large),'x'.repeat(3000));
 assert.equal(await journal.read(large,{maxBytes:1024}),null);
 const memory=await loadProjectMemory({journal,workspace:'/repo',profile:'coding',excludeRunIds:[excluded],maxJournalBytes:1024});
 assert.equal(memory.runs.includes(excluded),false);assert.equal(memory.partial,true);
 const bounded=await projectMemoryView({archive:{records:Array.from({length:50},(_,i)=>({kind:'decision',source:{run_id:uuid(),event_id:i+1},text:'backend '.repeat(120),freshness:'unknown'}))},task:'backend',maxBytes:800});
 assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=800);assert.equal(bounded.partial,true);
});
