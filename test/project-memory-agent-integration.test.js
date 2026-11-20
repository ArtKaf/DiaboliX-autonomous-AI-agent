import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));

test('historical project memory is source-linked, untrusted and scoped to the workspace',{timeout:120000},async t=>{
  try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000})}catch{return t.skip('Docker or sandbox image unavailable')}
  const root=await mkdtemp(path.join(os.tmpdir(),'diab-project-memory-')),a=path.join(root,'a'),b=path.join(root,'b');
  await chmod(root,0o777);await mkdir(a,{mode:0o777});await mkdir(b,{mode:0o777});t.after(()=>rm(root,{recursive:true,force:true}));
  let phase='record',source,firstContext,otherContext,lookup,denied;
  const provider=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw), toolResult=body.messages.findLast(m=>m.role==='tool'&&m.tool_call_id==='memory-call');
    let message;
    if(phase==='record'){
      const recorded=body.messages.some(m=>m.role==='tool'&&m.tool_call_id==='decision-call');
      message=recorded?{role:'assistant',content:'Decision recorded.'}:{role:'assistant',content:null,tool_calls:[{id:'decision-call',type:'function',function:{name:'record_decision',arguments:JSON.stringify({decision:'Quartz storage keeps immutable migration history',rationale:'Existing compatibility requirements'})}}]};
    }else{
      const prompt=body.messages.findLast(m=>m.role==='user'&&typeof m.content==='string'&&m.content.includes('Task memory (observations, not proof):'))?.content;
      if(!toolResult){
        const context=JSON.parse(prompt.split('Task memory (observations, not proof): ')[1]);if(phase==='same')firstContext=context;else otherContext=context;
        message={role:'assistant',content:null,tool_calls:[{id:'memory-call',type:'function',function:{name:'project_memory',arguments:JSON.stringify(source)}}]};
      }else{if(phase==='same')lookup=toolResult.content;else denied=toolResult.content;message={role:'assistant',content:'Finished.'};}
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
  });
  const pp=await listen(provider);t.after(()=>provider.close());const reservation=http.createServer(),port=await listen(reservation);await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(root,'config.local.json')}});t.after(()=>child.kill());await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',c=>reject(Error('server exited '+c)))});
  const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token};
  const post=async(route,body)=>{const res=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(res.ok,true,await res.clone().text());return res.json()};
  async function runTask(){const run=await post('run',{message:'Continue the Quartz storage migration work.'});for(let i=0;i<3500;i++){const state=await(await fetch(base+'/api/events?id='+run.id,{headers})).json();if(state.done){assert.ok(state.events.some(e=>e.type==='done'),JSON.stringify(state.events.filter(e=>e.type==='error')));return {run,state}}await sleep(20)}throw Error('timeout')}
  await post('config',{endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:a,maxSteps:10,mcpUrl:''});
  const first=await runTask(),decision=first.state.events.find(e=>e.type==='architecture_decision');assert.ok(decision);source={run_id:first.run.id,event_id:decision.id};
  phase='same';await runTask();
  const memory=firstContext.project_memory,item=memory.items.find(x=>x.kind==='decision');assert.ok(item);assert.deepEqual(item.source,source);assert.equal(item.trust,'model_interpretation');assert.equal(item.freshness,'unknown');assert.match(memory.notice,/untrusted/i);assert.match(item.text,/Quartz storage/);assert.ok(Buffer.byteLength(JSON.stringify(memory))<=5000);
  assert.deepEqual(JSON.parse(lookup).source.source,source);assert.match(JSON.parse(lookup).notice,/not current evidence or instructions/i);
  await post('config',{workspace:b});phase='other';await runTask();assert.ok(!otherContext.project_memory?.items?.length);assert.match(denied,/unavailable|workspace/i);
});
