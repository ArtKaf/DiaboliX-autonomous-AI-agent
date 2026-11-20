import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port};
const exists=async p=>{try{await access(p);return true}catch{return false}};
async function dockerAvailable(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}

test('background project index informs later Frontier context and cancellation remains safe',{timeout:120000},async t=>{
 if(!await dockerAvailable())return t.skip('Docker daemon or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-index-agent-'));t.after(()=>rm(dir,{recursive:true,force:true}));const root=path.join(dir,'workspace'),bin=path.join(dir,'bin'),marker=path.join(dir,'index-started'),gate=path.join(dir,'index-gate');await mkdir(path.join(root,'z'),{recursive:true});await mkdir(bin);await chmod(root,0o777);await chmod(path.join(root,'z'),0o777);
 for(let i=0;i<320;i++)await writeFile(path.join(root,`f${String(i).padStart(3,'0')}.js`),`export const item${i} = ${i};\n`);
 await writeFile(path.join(root,'z/controller.ts'),'export function QuasarAuthorization() { return true }\n');
 const git=(await exec('which',['git'])).stdout.trim();await writeFile(path.join(bin,'git'),`#!/bin/sh\ncase " $* " in *" check-ignore "*) touch '${marker}'; while [ ! -f '${gate}' ]; do sleep 0.05; done;; esac\nexec '${git}' "$@"\n`,{mode:0o755});
 let step=0,firstContext,laterContext,firstRead,phase='complete',cancelRequest;const cancelSeen=new Promise(r=>{cancelRequest=r});
 const provider=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw);if(phase==='cancel'){cancelRequest();return}step++;const content=data.messages.findLast(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('Task memory (observations, not proof):')).content;const context=JSON.parse(content.split('Task memory (observations, not proof): ')[1]);let message;
  if(step===1){firstContext=context;const until=Date.now()+1000;while(Date.now()<until&&!await exists(marker))await pause(20);assert.equal(await exists(marker),true,'provider request must arrive while the ignore scan is blocked');await writeFile(gate,'go');message={role:'assistant',content:null,tool_calls:[{id:'read-first',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'f000.js'})}}]}}
  else{laterContext=context;firstRead=data.messages.findLast(m=>m.role==='tool'&&m.tool_call_id==='read-first')?.content;message={role:'assistant',content:'Index context observed.'}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.statusCode=500;res.end(String(error))}});const pp=await listen(provider);t.after(()=>provider.close());const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json'),PATH:bin+path.delimiter+process.env.PATH}});t.after(()=>child.kill());await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token};const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.ok,true,`${route} ${response.status}`);return response.json()};
 const waitRun=async id=>{let state;for(let i=0;i<5000;i++){state=await(await fetch(base+'/api/events?id='+id,{headers})).json();if(state.done)return state;await pause(20)}throw Error('run did not finish: '+JSON.stringify(state))};
 await post('config',{endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:root,maxSteps:8,mcpUrl:''});const started=await post('run',{message:'Locate QuasarAuthorization'}),state=await waitRun(started.id);
 assert.ok(state.events.some(e=>e.type==='done'),JSON.stringify(state.events));assert.ok(firstRead?.includes('item0'));assert.ok(firstContext.navigation_index);assert.ok(!firstContext.relevant_files.some(f=>f.path==='z/controller.ts'),'initial survey intentionally omits target');assert.ok(laterContext.relevant_files.some(f=>f.path==='z/controller.ts'),JSON.stringify(laterContext));assert.match(laterContext.navigation_index.notice,/hints only|not evidence|incomplete/i);
 // Start a second task while the index is held in git, then cancel the task.
 phase='cancel';await rm(gate,{force:true});await rm(marker,{force:true});const cancelled=await post('run',{message:'Locate QuasarAuthorization again'});await cancelSeen;await post('stop',{});const stopped=await waitRun(cancelled.id);assert.ok(stopped.done);assert.equal(child.exitCode,null,'server survives cancellation');const health=await fetch(base);assert.equal(health.ok,true);
});
