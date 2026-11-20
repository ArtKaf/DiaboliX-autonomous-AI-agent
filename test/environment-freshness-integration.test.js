import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec=promisify(execFile);
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port};
async function dockerAvailable(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}

test('project_state detects a changed binary dependency lock outside the Shadow Git text tree',{timeout:90000},async t=>{
 if(!await dockerAvailable())return t.skip('Docker daemon or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-env-integration-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'bun.lockb'),Buffer.from([0,1,2]),{mode:0o666});await writeFile(path.join(dir,'verify.cjs'),"const test=require('node:test');const assert=require('node:assert/strict');test('fixture',()=>assert.equal(1+1,2));\n",{mode:0o666});
 let step=0,first,second;const provider=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);step++;const prior=id=>data.messages.findLast(m=>m.role==='tool'&&m.tool_call_id===`call-${id}`)?.content;let name,args;
  if(step===1){name='run_tests';args={command:'node --test verify.cjs'}}
  else if(step===2){name='project_state';args={}}
  else if(step===3){first=JSON.parse(prior(2));await writeFile(path.join(dir,'bun.lockb'),Buffer.from([0,1,3]));name='project_state';args={path:'verify.cjs'}}
  else{second=JSON.parse(prior(3))}
  const message=name?{role:'assistant',content:null,tool_calls:[{id:`call-${step}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'Reported the observed test and environment state.'};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.statusCode=500;res.end(String(error))}});const pp=await listen(provider);t.after(()=>provider.close());
 const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});t.after(()=>child.kill());await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.ok,true);return response.json()};await post('config',{endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:dir,maxSteps:8,mcpUrl:''});const run=await post('run',{message:'Run the existing test and inspect its verification evidence.'});let result;
 for(let i=0;i<3500;i++){result=await(await fetch(base+'/api/events?id='+run.id,{headers})).json();if(result.done)break;await new Promise(r=>setTimeout(r,20))}
 assert.equal(result.done,true);assert.ok(result.events.some(e=>e.type==='done'),JSON.stringify(result.events));assert.equal(first.tree,second.tree,'binary change should be outside the text-only Shadow Git tree');assert.equal(first.tests.status,'success');assert.equal(first.tests.fresh,true);assert.equal(first.tests.environment.scope,'partial');assert.equal(second.tests.fresh,false);assert.equal(second.tests.environment.status,'changed');assert.ok(second.tests.environment.changed.includes('bun.lockb'));
});
