import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,chmod,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port};
test('project memory forget and restore affect new tasks only in the selected workspace', {timeout:180000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'diabolix-memory-api-'));
 const workspace=path.join(root,'first'),other=path.join(root,'second');await chmod(root,0o777);await mkdir(workspace,{mode:0o777});await mkdir(other,{mode:0o777});
 let child;const provider=http.createServer();t.after(async()=>{child?.kill('SIGTERM');await new Promise(resolve=>provider.close(resolve));await rm(root,{recursive:true,force:true})});
 let phase='create',source,requestContext={},responses={};
 provider.on('request',async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  const current=body.messages.findLast(item=>item.role==='user'&&typeof item.content==='string'&&item.content.includes('Task memory (observations, not proof): '));
  if(current){const text=current.content.split('Task memory (observations, not proof): ')[1];requestContext[phase]??=JSON.parse(text)}
  const previous=body.messages.findLast(item=>item.role==='tool'&&['decision','lookup'].includes(item.tool_call_id));let message;
  if(phase==='create'&&!previous)message={role:'assistant',content:null,tool_calls:[{id:'decision',type:'function',function:{name:'record_decision',arguments:JSON.stringify({decision:'Authentication uses signed session cookies'})}}]};
  else if(['forgotten','restored','other'].includes(phase)&&!previous)message={role:'assistant',content:null,tool_calls:[{id:'lookup',type:'function',function:{name:'project_memory',arguments:JSON.stringify(source)}}]};
  else{if(previous?.tool_call_id==='lookup')responses[phase]=previous.content;message={role:'assistant',content:'Done.'}}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.writeHead(500);res.end(String(error))}});
 const providerPort=await listen(provider),reservation=http.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
 child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(root,'config.local.json')}});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base='http://127.0.0.1:'+port,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)?.[1];assert.ok(token);
 const headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 async function api(route,body){const response=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}),result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result}
 await api('config',{endpoint:`http://127.0.0.1:${providerPort}/v1`,model:'test',workspace,maxSteps:5,mcpUrl:''});
 async function run(){const started=await api('run',{message:'Authentication session changes'});let state;for(let i=0;i<4500;i++){state=await api('events?id='+started.id);if(state.done)break;await new Promise(resolve=>setTimeout(resolve,20))}assert.ok(state?.done,JSON.stringify(state?.events));assert.ok(state.events.some(event=>event.type==='done'),JSON.stringify(state.events));return started.id}
 const first=await run(),journalPath=path.join(root,'.diabolix-sessions',first+'.jsonl'),originalJournal=await readFile(journalPath,'utf8');
 let listing=await api('project-memory');const decision=listing.items.find(item=>item.kind==='decision'&&item.source.run_id===first);assert.ok(decision,JSON.stringify(listing));source=decision.source;assert.equal(decision.excluded,false);
 await api('project-memory',{action:'forget',...source});listing=await api('project-memory');assert.equal(listing.items.find(item=>item.source.run_id===first&&item.source.event_id===source.event_id).excluded,true);
 phase='forgotten';await run();assert.equal(requestContext.forgotten.project_memory?.items.some(item=>item.source.run_id===first),undefined);assert.match(responses.forgotten,/unavailable/);
 await api('project-memory',{action:'restore',...source});phase='restored';await run();assert.ok(requestContext.restored.project_memory.items.some(item=>item.source.run_id===first&&item.source.event_id===source.event_id));assert.match(responses.restored,/Authentication uses signed session cookies/);
 await api('config',{workspace:other});listing=await api('project-memory');assert.ok(!listing.items.some(item=>item.source.run_id===first));phase='other';await run();assert.equal(requestContext.other.project_memory?.items.some(item=>item.source.run_id===first),undefined);assert.match(responses.other,/unavailable/);
 assert.equal(await readFile(journalPath,'utf8'),originalJournal);
});
