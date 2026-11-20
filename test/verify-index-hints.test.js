import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ShadowGit} from '../shadow.js';
import {verifyIndexHints} from '../verify-index-hints.js';

const hash=s=>crypto.createHash('sha256').update(s).digest('hex');

test('admits a matching indexed file beyond the first 200 inventory entries',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-verified-index-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await Promise.all(Array.from({length:205},(_,i)=>writeFile(path.join(dir,`a${String(i).padStart(3,'0')}.js`),'export const filler=1;\n')));
 const content='export function rareMigrationHandler() {}\n';await writeFile(path.join(dir,'z-migration.js'),content);
 const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());const snapshot=await shadow.reviewSnapshot();
 assert.equal(snapshot.inventory.files.length,200);assert.ok(snapshot.inventory.has_more);assert.ok(!snapshot.inventory.files.some(item=>item.path==='z-migration.js'));
 const hints={files:[{path:'z-migration.js',score:20,hash:hash(content)}],partial:false};
 const result=await verifyIndexHints({hints,shadow,tree:snapshot.tree});assert.deepEqual(result.files,[{path:'z-migration.js',score:20,hash:hash(content)}]);assert.doesNotMatch(JSON.stringify(result),/rareMigrationHandler/);
 await writeFile(path.join(dir,'z-migration.js'),'changed\n');const next=await shadow.tree();const stale=await verifyIndexHints({hints,shadow,tree:next});assert.deepEqual(stale.files,[]);assert.equal(stale.partial,true);
});

test('bounds hash lookups and rejects stale, invalid, duplicate and missing candidates',async()=>{
 const digest=hash('x'),tree='a'.repeat(40),seen=[];
 const hints={files:[{path:'ok.js',hash:digest,score:2},{path:'ok.js',hash:digest,score:3},{path:'../escape.js',hash:digest,score:1},{path:'.env',hash:digest,score:1},{path:'stale.js',hash:digest,score:1},{path:'missing.js',hash:digest,score:1},...Array.from({length:20},(_,i)=>({path:`file${i}.js`,hash:digest,score:1}))]};
 const shadow={hashFileAtTree:async(name,requestedTree)=>{assert.equal(requestedTree,tree);seen.push(name);if(name==='stale.js')return hash('different');if(name==='missing.js')return null;return digest}};
 const result=await verifyIndexHints({hints,shadow,tree});assert.equal(result.partial,true);assert.ok(result.files.some(x=>x.path==='ok.js'));assert.ok(!result.files.some(x=>['stale.js','missing.js','../escape.js','.env'].includes(x.path)));assert.ok(seen.length<=20);assert.equal(seen.filter(x=>x==='ok.js').length,1);assert.equal(seen.includes('file19.js'),false);
 const unavailable=await verifyIndexHints({hints,shadow,tree:'invalid'});assert.deepEqual(unavailable.files,[]);assert.equal(unavailable.partial,true);
 await assert.rejects(()=>verifyIndexHints({hints,shadow,tree,limit:21}),TypeError);
});

test('a failed snapshot lookup is dropped without hiding other candidates',async()=>{
 const digest=hash('x'),shadow={hashFileAtTree:async name=>{if(name==='bad.js')throw Error('git failed');return digest}};
 const result=await verifyIndexHints({hints:{files:[{path:'bad.js',hash:digest,score:1},{path:'good.js',hash:digest,score:2}]},shadow,tree:'a'.repeat(40)});
 assert.deepEqual(result.files.map(x=>x.path),['good.js']);assert.equal(result.partial,true);
});

test('cancellation aborts an in-flight lookup and propagates to its signal',async()=>{
 const digest=hash('x'),controller=new AbortController();let received,started;
 const ready=new Promise(resolve=>{started=resolve});const shadow={hashFileAtTree:async(_name,_tree,{signal})=>{received=signal;started();return new Promise(()=>{})}};
 const work=verifyIndexHints({hints:{files:[{path:'a.js',hash:digest,score:1}]},shadow,tree:'a'.repeat(40),signal:controller.signal});
 await ready;controller.abort();await assert.rejects(work,{name:'AbortError'});assert.equal(received.aborted,true);
 let called=false;await assert.rejects(verifyIndexHints({hints:{files:[]},shadow:{hashFileAtTree:()=>{called=true}},tree:'a'.repeat(40),signal:controller.signal}),{name:'AbortError'});assert.equal(called,false);
});

test('deadline bounds uncooperative lookup and reports partial results',async()=>{
 const digest=hash('x');let received;const shadow={hashFileAtTree:(_name,_tree,{signal})=>{received=signal;return new Promise(()=>{})}};
 const start=Date.now();const result=await verifyIndexHints({hints:{files:[{path:'a.js',hash:digest,score:1}]},shadow,tree:'a'.repeat(40),timeoutMs:25});
 assert.ok(Date.now()-start<2000);assert.equal(result.partial,true);assert.deepEqual(result.files,[]);assert.equal(received.aborted,true);
});
