import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const listen=async server=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port};
test('project state, smart edit, diagnostics and rollback work together in the agent',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-project-tools-'));await chmod(dir,0o777);const file=path.join(dir,'app.js'),original='const value = 1;\n';await writeFile(file,original,{mode:0o666});t.after(()=>rm(dir,{recursive:true,force:true}));let step=0;const observed={};
 const provider=http.createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw),sys=data.messages[0].content;let message;
  if(sys.includes('planning specialist'))message={role:'assistant',content:'Inspect and update the file.'};
  else if(sys.includes('You are a reviewer'))message={role:'assistant',content:JSON.stringify({approved:true,feedback:'OK'})};
  else{step++;const prior=id=>data.messages.findLast(m=>m.role==='tool'&&m.tool_call_id===`call-${id}`)?.content;let name,args;
   const edit=()=>({path:'app.js',expected_hash:observed.initial.requested_path.hash,start_line:1,end_line:1,replacement_content:'const value = 2; // '+ 'a'.repeat(26000)});
   if(step===1){name='project_state';args={path:'app.js'}}
   else if(step===2){observed.initial=JSON.parse(prior(1));name='smart_edit';args={...edit(),preview:true}}
   else if(step===3){observed.preview=prior(2);observed.beforeApply=await readFile(file,'utf8');name='smart_edit';args=edit()}
   else if(step===4){observed.edit=prior(3);name='project_state';args={path:'app.js'}}
   else if(step===5){observed.changed=JSON.parse(prior(4));name='diagnose_project';args={paths:['app.js']}}
   else if(step===6){observed.diagnosis=prior(5);name='verify_task';args={}}
   else if(step===7){observed.verification=JSON.parse(prior(6));name='project_state';args={path:'app.js'}}
   else if(step===8){observed.checked=JSON.parse(prior(7));name='rollback_last_write';args={}}
   else{observed.rollback=prior(8)}
   message=name?{role:'assistant',content:null,tool_calls:[{id:`call-${step}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'Done'}
  }res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}))
 }catch(e){res.statusCode=500;res.end(String(e))}});
 const pp=await listen(provider);t.after(()=>provider.close());const reserve=http.createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});t.after(()=>child.kill());await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)[1],headers={'Content-Type':'application/json','X-Diabolix-Token':token},post=async(route,body)=>(await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)})).json();await post('config',{executionMode:'quick',endpoint:`http://127.0.0.1:${pp}/v1`,model:'test',workspace:dir,maxSteps:12,mcpUrl:''});const run=await post('run',{message:'Edit the constant.'});let result;for(let i=0;i<3000;i++){result=await(await fetch(base+'/api/events?id='+run.id,{headers})).json();if(result.done)break;await new Promise(r=>setTimeout(r,20))}
 assert.ok(result.done,JSON.stringify(result.events));assert.equal(observed.initial.requested_path.exists,true);assert.equal(observed.initial.tests.status,'not_run');assert.match(observed.preview,/\"preview\":true/);assert.equal(observed.beforeApply,original);assert.equal(observed.verification.tests.status,'not_observed_via_run_tests');assert.equal(observed.verification.project_diagnostics.fresh,true);assert.match(observed.edit,/\+const value = 2;/);assert.equal(observed.changed.files.find(x=>x.path==='app.js').status,'M');assert.equal(observed.changed.post_edit_diagnostics[0].fresh,true);assert.match(observed.diagnosis,/\[код: 0\]/);assert.equal(observed.checked.project_diagnostics.fresh,true);assert.equal(observed.checked.project_diagnostics.status,'completed');assert.match(observed.rollback,/\[код: 0\]/);assert.equal(await readFile(file,'utf8'),original);
});
