import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,realpath,writeFile,access} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {TaskJournal} from '../task-journal.js';
import {ProjectMemoryControls} from '../project-memory-controls.js';

const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(file){for(let i=0;i<200;i++){try{await access(file);return}catch{}await delay(20)}throw Error('Timed out waiting for the instrumented GET request');}

test('project-memory GET uses one workspace/profile snapshot while config changes concurrently',{timeout:15000},async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'diabolix-memory-race-'))),oldWorkspace=path.join(root,'old'),newWorkspace=path.join(root,'new'),journalDir=path.join(root,'.diabolix-sessions'),gate=path.join(root,'gate');
 await Promise.all([mkdir(oldWorkspace),mkdir(newWorkspace)]);
 const journal=new TaskJournal(journalDir);await journal.init();const id=crypto.randomUUID();
 await journal.append(id,{kind:'start',journal_version:1,task:'Example',workspace:oldWorkspace,profile:'coding'});
 await journal.append(id,{kind:'event',event:{id:1,type:'architecture_decision',text:'Use a session cache'}});
 await journal.append(id,{kind:'event',event:{id:2,type:'done'}});await journal.append(id,{kind:'event',event:{id:3,type:'finished'}});await journal.flush();
 const controls=new ProjectMemoryControls(journalDir);await controls.forget({workspace:oldWorkspace,profile:'coding',run_id:id,event_id:1});
 // Instrument only the Node process used by this test. Pausing opendir lets a
 // real config POST complete while the real GET still holds its first scope.
 const preload=path.join(root,'gate.mjs');await writeFile(preload,`import fs from 'node:fs/promises';import {existsSync} from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.opendir;let entered=false;fs.opendir=async function(...args){if(!entered&&args[0]===process.env.TEST_JOURNAL_DIR&&existsSync(process.env.TEST_GATE+'.arm')){entered=true;await fs.writeFile(process.env.TEST_GATE+'.ready','ready');while(!existsSync(process.env.TEST_GATE+'.release'))await new Promise(r=>setTimeout(r,10));}return original.apply(this,args)};syncBuiltinESMExports();`);
 const reserve=http.createServer(),port=await listen(reserve);await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,['--import',preload,'server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(root,'config.json'),TEST_JOURNAL_DIR:journalDir,TEST_GATE:gate}});
 t.after(async()=>{child.kill();await rm(root,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base='http://127.0.0.1:'+port,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)?.[1];assert.ok(token);const headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 async function post(body){const response=await fetch(base+'/api/config',{method:'POST',headers,body:JSON.stringify(body)});assert.ok(response.ok,await response.text());}
 await post({workspace:oldWorkspace,model:'test',endpoint:'http://127.0.0.1:3001/v1',mcpUrl:''});
 await writeFile(gate+'.arm','arm');const inFlight=fetch(base+'/api/project-memory',{headers,signal:AbortSignal.timeout(10000)});await waitFor(gate+'.ready');
 await post({workspace:newWorkspace});await writeFile(gate+'.release','release');
 const response=await inFlight;assert.equal(response.status,200);const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].source.run_id,id);assert.equal(data.items[0].excluded,true,'exclusions must come from the same workspace as returned records');
 const current=await(await fetch(base+'/api/project-memory',{headers})).json();assert.equal(current.items.length,0);
});
