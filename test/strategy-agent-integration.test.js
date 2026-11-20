import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile), sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));

test('strategy search requires opt-in, returns its advice to the worker and counts model calls',{timeout:120000},async t=>{
  try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000})}catch{return t.skip('Docker or sandbox image unavailable')}
  const dir=await mkdtemp(path.join(os.tmpdir(),'diab-strategy-integration-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
  let providerCalls=[],lastWorkerResult;
  const proposals=JSON.stringify({plans:['Add a backwards compatible migration with dual reads','Replace the storage adapter and migrate with a cutover']});
  const distinct=JSON.stringify({distinct:true,first_strategy:'Use a backwards compatible migration',second_strategy:'Replace the storage adapter',difference:'The approaches have different rollout and storage designs.'});
  const provider=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);providerCalls.push(body);
    let message;
    if(body.tools){
      const result=body.messages.findLast(m=>m.role==='tool'&&m.tool_call_id==='strategy-1');
      if(!result) message={role:'assistant',content:null,tool_calls:[{id:'strategy-1',type:'function',function:{name:'strategy_search',arguments:JSON.stringify({question:'Which migration approach preserves backwards compatibility?'})}}]};
      else {lastWorkerResult=result.content;message={role:'assistant',content:'Finished after inspecting the strategy response.'};}
    }else{
      const system=body.messages[0].content;
      const content=system.includes('Propose two distinct plans')?proposals:system.includes('Compare the two plans')?distinct:system.includes('Simulate the plan')?'{"score":0.8}':'{}';
      message={role:'assistant',content};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}));
  });
  const pp=await listen(provider);t.after(()=>provider.close());
  const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',c=>reject(Error('server exited '+c)))});
  const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token};
  const post=async(route,body)=>{const res=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(res.ok,true,await res.clone().text());return res.json()};
  async function runTask(){const run=await post('run',{message:'Inspect the migration architecture.'});for(let i=0;i<3500;i++){const state=await(await fetch(base+'/api/events?id='+run.id,{headers})).json();if(state.done)return state;await sleep(20)}throw Error('timeout')}
  await post('config',{endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:dir,maxSteps:20,mcpUrl:'',strategySearch:false});
  const disabled=await runTask();assert.ok(disabled.events.some(e=>e.type==='done'));
  assert.ok(providerCalls.filter(x=>x.tools).every(x=>!x.tools.some(t=>t.function.name==='strategy_search')));
  assert.equal(providerCalls.filter(x=>!x.tools).length,0);assert.match(lastWorkerResult,/disabled|prioritized/i);
  providerCalls=[];lastWorkerResult=undefined;
  await post('config',{strategySearch:true});
  const enabled=await runTask();assert.ok(enabled.events.some(e=>e.type==='done'));
  assert.ok(providerCalls.some(x=>x.tools?.some(t=>t.function.name==='strategy_search')));
  const extraCalls=providerCalls.filter(x=>!x.tools);assert.equal(extraCalls.length,4);assert.ok(extraCalls.every(x=>x.max_tokens===600));
  const advice=JSON.parse(lastWorkerResult);assert.equal(advice.status,'ready');assert.equal(advice.calls,4);assert.match(advice.notice,/unverified/);
  const telemetry=enabled.events.filter(e=>e.type==='telemetry').at(-1);assert.ok(telemetry.usage.steps>=6);assert.equal(telemetry.usage.planner.requests,4);
});
