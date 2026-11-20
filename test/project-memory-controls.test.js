import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,symlink} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {ProjectMemoryControls,filterProjectMemory} from '../project-memory-controls.js';

async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-forget-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,controls:new ProjectMemoryControls(dir)}}
test('forget is scoped, persistent, owner-only and preserves original journal',async t=>{
 const {dir,controls}=await fixture(t),id=crypto.randomUUID(),journal=path.join(dir,id+'.jsonl');await writeFile(journal,'original history\n');const before=await readFile(journal,'utf8');
 const scope={workspace:'/sensitive/local/project',profile:'coding'},ref={run_id:id,event_id:2};assert.deepEqual(await controls.list(scope),[]);
 const archive={records:[{kind:'decision',source:ref,text:'architecture decision'}],runs:[id]};
 assert.equal((await filterProjectMemory(archive,controls,scope)).records.length,1);
 assert.equal((await controls.forget({...scope,...ref})).forgotten,true);
 assert.equal((await controls.forget({...scope,...ref})).already_excluded,true);
 assert.equal((await filterProjectMemory(archive,controls,scope)).records.length,0);
 assert.equal((await filterProjectMemory(archive,controls,{...scope,profile:'trading'})).records.length,1);
 assert.equal((await filterProjectMemory(archive,controls,{...scope,workspace:'/other'})).records.length,1);
 assert.deepEqual(await new ProjectMemoryControls(dir).list(scope),[ref]);
 const data=await readFile(controls.file,'utf8');assert.doesNotMatch(data,/sensitive|local\/project|architecture decision|original history/);
 assert.equal((await stat(controls.file)).mode&0o777,0o600);assert.equal(await readFile(journal,'utf8'),before);
 assert.deepEqual(await controls.restore({...scope,...ref}),{restored:true});assert.deepEqual(await controls.list(scope),[]);
});
test('parallel operations serialize and invalid IDs are rejected',async t=>{
 const {controls}=await fixture(t),scope={workspace:'/repo',profile:'coding'},id=crypto.randomUUID();
 await Promise.all(Array.from({length:25},(_,i)=>controls.forget({...scope,run_id:id,event_id:i+1})));
 assert.equal((await controls.list(scope)).length,25);
 await assert.rejects(controls.forget({...scope,run_id:'../../x',event_id:1}),/Invalid/);
 await assert.rejects(controls.forget({...scope,run_id:id,event_id:0}),/Invalid/);
 assert.equal((await controls.list(scope)).length,25);
});
test('corrupt or symlink exclusion files fail closed instead of exposing forgotten records',async t=>{
 const {dir,controls}=await fixture(t),scope={workspace:'/repo',profile:'coding'},id=crypto.randomUUID();
 const archive={records:[{source:{run_id:id,event_id:1},text:'previously forgotten'}]};
 await writeFile(controls.file,'{invalid');await assert.rejects(filterProjectMemory(archive,controls,scope),/corrupted/);
 await rm(controls.file);const target=path.join(dir,'target');await writeFile(target,'{}');await symlink(target,controls.file);
 await assert.rejects(filterProjectMemory(archive,controls,scope));
});
