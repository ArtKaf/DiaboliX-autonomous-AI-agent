import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,writeFile,rm,access,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const listen=async s=>{await new Promise(r=>s.listen(0,'127.0.0.1',r));return s.address().port};
const exists=async p=>{try{await access(p);return true}catch{return false}};
async function waitFor(fn,timeout=5000){const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await pause(20)}throw Error('Timed out waiting for controlled index state');}
async function dockerAvailable(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}

test('an index hint disappears immediately when ignore rules change during a delayed rescan',{timeout:120000},async t=>{
 if(!await dockerAvailable())return t.skip('Docker daemon or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-index-ignore-')),root=path.join(dir,'workspace'),bin=path.join(dir,'bin'),first=path.join(dir,'first'),second=path.join(dir,'second'),release1=path.join(dir,'release1'),release2=path.join(dir,'release2'),cache=path.join(dir,'.diabolix-sessions','project-index');
 await mkdir(path.join(root,'z'),{recursive:true});await mkdir(bin);await chmod(root,0o777);await chmod(path.join(root,'z'),0o777);
 for(let i=0;i<205;i++)await writeFile(path.join(root,`f${String(i).padStart(3,'0')}.js`),`export const item${i} = ${i};\n`);
 await writeFile(path.join(root,'z/controller.ts'),'export function QuasarAuthorization() { return true }\n');
 const git=(await exec('which',['git'])).stdout.trim();await writeFile(path.join(bin,'git'),`#!/bin/sh\ncase " $* " in *" check-ignore "*) if [ ! -f '${first}' ]; then touch '${first}'; while [ ! -f '${release1}' ]; do sleep 0.05; done; else touch '${second}'; while [ ! -f '${release2}' ]; do sleep 0.05; done; fi;; esac\nexec '${git}' "$@"\n`,{mode:0o755});
 let step=0,before,after,toolResult,providerError;const provider=http.createServer(async(req,res)=>{try{
  let raw='';for await(const c of req)raw+=c;const data=JSON.parse(raw),content=data.messages.findLast(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('Task memory (observations, not proof):')).content,context=JSON.parse(content.split('Task memory (observations, not proof): ')[1]);let message;
  if(++step===1){await waitFor(()=>exists(first));await writeFile(release1,'go');await waitFor(async()=>{try{return (await readdir(cache)).some(x=>x.endsWith('.json'))}catch{return false}});await pause(250);message={role:'assistant',content:null,tool_calls:[{id:'read',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'f000.js'})}}]}}
  else if(step===2){before=context;message={role:'assistant',content:null,tool_calls:[{id:'ignore',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'.gitignore',content:'z/controller.ts\n'})}}]}}
  else{after=context;toolResult=data.messages.findLast(m=>m.role==='tool'&&m.tool_call_id==='ignore')?.content;await waitFor(()=>exists(second));await writeFile(release2,'go');message={role:'assistant',content:'Finished.'}}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){providerError=error;await writeFile(release2,'go').catch(()=>{});res.writeHead(500);res.end('fixture error')}});const pp=await listen(provider);t.after(()=>provider.close());const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json'),PATH:bin+path.delimiter+process.env.PATH}});t.after(async()=>{await Promise.allSettled([writeFile(release1,'go'),writeFile(release2,'go')]);child.kill();await rm(dir,{recursive:true,force:true})});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token};const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.ok(response.ok,`${route} ${response.status}`);return response.json()};
 await post('config',{endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:root,maxSteps:8,mcpUrl:''});const started=await post('run',{message:'Locate QuasarAuthorization'});let state;for(let i=0;i<4500;i++){state=await(await fetch(base+'/api/events?id='+started.id,{headers})).json();if(state.done||providerError)break;await pause(20)}
 if(providerError)throw providerError;assert.ok(state.done,JSON.stringify(state.events));assert.ok(state.events.some(e=>e.type==='done'),JSON.stringify(state.events));assert.ok(before.relevant_files.some(f=>f.path==='z/controller.ts'),'precondition: initial index surfaces the path outside first inventory page');assert.match(toolResult||'',/\[код: 0\]/);assert.ok(!after.relevant_files.some(f=>f.path==='z/controller.ts'),'old index hint must be withheld while updated gitignore is still being scanned');assert.equal(after.navigation_index.partial,true);
});
