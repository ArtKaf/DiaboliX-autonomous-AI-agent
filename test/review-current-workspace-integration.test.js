import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,chmod,rm,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port};
test('review sees files created after an empty initial scan and rejects a snapshot changed during review',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-review-current-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
 let phase='create',research=0,worker=0,reviewCalls=0,researchOutput,reviewInput,exactFile,missingFile,hasProjectState;
 const provider=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw),sys=data.messages[0].content;let msg;
  if(sys.includes('read-only repository research specialist')||sys.includes('planning specialist')){research++;msg={role:'assistant',content:'Unexpected legacy role.'}}
  else if(sys.includes('You are a reviewer')){
   reviewCalls++;const input=JSON.parse(data.messages[1].content);
   if(phase==='create'&&reviewCalls===1){reviewInput=input;hasProjectState=data.tools.some(x=>x.function.name==='project_state');msg={role:'assistant',content:null,tool_calls:[{id:'exists',type:'function',function:{name:'project_state',arguments:JSON.stringify({path:'src/app.js'})}},{id:'missing',type:'function',function:{name:'project_state',arguments:JSON.stringify({path:'not-created.js'})}}]}}
   else if(phase==='create'){exactFile=JSON.parse(data.messages.find(m=>m.tool_call_id==='exists').content.split('\n[')[0]);missingFile=JSON.parse(data.messages.find(m=>m.tool_call_id==='missing').content.split('\n[')[0]);const paths=input.workspace_snapshot.inventory.files.map(x=>x.path);const approved=paths.includes('src/app.js')&&paths.includes('README.md')&&exactFile.requested_path.exists&&!missingFile.requested_path.exists;msg={role:'assistant',content:JSON.stringify({approved,feedback:approved?'Both files exist.':'The files are missing.',requirements:[{id:'R1',status:'supported',evidence_ids:[input.workspace_snapshot.source.event_id]}]})}}
   else {await writeFile(path.join(dir,'external.txt'),'modified while reviewer was thinking');msg={role:'assistant',content:JSON.stringify({approved:true,feedback:'Approved stale snapshot.',requirements:[{id:'R1',status:'supported',evidence_ids:[input.workspace_snapshot.source.event_id]}]})}}
  }else if(phase==='create'){
   worker++;if(worker===1)msg={role:'assistant',content:null,tool_calls:[{id:'initial-list',type:'function',function:{name:'list_files',arguments:JSON.stringify({path:'.'})}}]};
   else if(worker===2){researchOutput=data.messages.find(m=>m.tool_call_id==='initial-list')?.content;msg={role:'assistant',content:null,tool_calls:[{id:'write-app',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'src/app.js',content:'export const ready = true;\n'})}},{id:'write-readme',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'README.md',content:'# Ready\n'})}}]}}
   else if(worker===3)msg={role:'assistant',content:null,tool_calls:[{id:'request-review',type:'function',function:{name:'request_review',arguments:JSON.stringify({summary:'Review newly created files.'})}}]};else msg={role:'assistant',content:'Done.'};
  }else {worker++;msg=worker===1?{role:'assistant',content:null,tool_calls:[{id:'request-race-review',type:'function',function:{name:'request_review',arguments:JSON.stringify({summary:'Review current files.'})}}]}:{role:'assistant',content:'Workspace changed during review; this result remains unverified.'}};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:msg}]}));
 }catch(error){res.writeHead(500);res.end(String(error))}});
 const pp=await listen(provider);t.after(()=>provider.close());const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});t.after(()=>child.kill());await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base='http://127.0.0.1:'+port,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token},post=async(route,body)=>(await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)})).json();
 await post('config',{endpoint:'http://127.0.0.1:'+pp+'/v1',model:'test',workspace:dir,maxSteps:8,mcpUrl:''});
 async function run(message){const started=await post('run',{message,session:phase});let state;for(let i=0;i<4000;i++){state=await(await fetch(base+'/api/events?id='+started.id,{headers})).json();if(state.done)break;await new Promise(r=>setTimeout(r,20))}assert.ok(state.done,JSON.stringify(state.events));return state}
 const result=await run('Create src/app.js and README.md');assert.ok(result.events.some(e=>e.type==='done'),JSON.stringify(result.events));assert.ok(researchOutput);assert.doesNotMatch(researchOutput,/src|README\.md/);assert.equal(await readFile(path.join(dir,'src/app.js'),'utf8'),'export const ready = true;\n');
 assert.equal(hasProjectState,true);assert.equal(exactFile.requested_path.exists,true);assert.equal(missingFile.requested_path.exists,false);assert.equal(exactFile.tree_unchanged_during_check,true);
 const snapshot=reviewInput.workspace_snapshot;assert.ok(snapshot.inventory.files.some(x=>x.path==='src/app.js'));assert.ok(snapshot.inventory.files.some(x=>x.path==='README.md'));assert.equal(snapshot.tree,reviewInput.verification.tree);assert.equal(reviewInput.shared_memory.research_summary,undefined);assert.ok(reviewInput.shared_memory.observations.some(x=>x.tool==='workspace_snapshot'&&x.freshness==='current'));
 const observation=result.events.find(e=>e.id===snapshot.source.event_id);assert.equal(observation.name,'workspace_snapshot');assert.equal(observation.memory_source.tree_after,snapshot.tree);assert.equal(result.events.find(e=>e.type==='review_assessment').assessments[0].status,'supported_by_reviewer');assert.ok(result.events.some(e=>e.type==='review_assessment'&&e.feedback.includes('Both files exist')));assert.equal(research,0);
 phase='race';research=0;worker=0;reviewCalls=0;const race=await run('Inspect current files');const assessment=race.events.find(e=>e.type==='review_assessment');assert.equal(assessment.reviewer_approved,false);assert.equal(assessment.assessments[0].status,'unconfirmed');assert.match(assessment.feedback,/changed during review/);
});
