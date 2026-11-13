import {mkdtemp,writeFile,readFile,mkdir,rm,chmod,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';import crypto from 'node:crypto';
import {createServer} from 'node:net';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {cases} from './cases.js';
import {sandboxTool} from '../sandbox.js';
import {safeJournalEvent} from '../task-journal.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const endpoint=process.env.DIABOLIX_EVAL_ENDPOINT,model=process.env.DIABOLIX_EVAL_MODEL,key=process.env.DIABOLIX_EVAL_API_KEY||'';
const selected=process.env.DIABOLIX_EVAL_CASE,executionMode=process.env.DIABOLIX_EVAL_MODE||'standard',timeout=Number(process.env.DIABOLIX_EVAL_TIMEOUT_MS||240000);
const repeats=Number(process.env.DIABOLIX_EVAL_REPEATS||1);
if(!endpoint||!model){console.error('Set DIABOLIX_EVAL_ENDPOINT and DIABOLIX_EVAL_MODEL; DIABOLIX_EVAL_API_KEY is optional.');process.exit(2)}
if(!Number.isFinite(timeout)||timeout<10000||timeout>1800000)throw Error('Invalid evaluation timeout');
if(!['quick','standard','deep','auto'].includes(executionMode))throw Error('Invalid evaluation mode');
if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw Error('DIABOLIX_EVAL_REPEATS must be an integer from 1 to 10');
const chosen=selected?cases.filter(c=>c.id===selected):cases;if(!chosen.length)throw Error('Unknown evaluation case');
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port}
async function runCase(item){
 const fixtureHash=crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-eval-'));await chmod(dir,0o777);let child;const started=Date.now();
 try{
  const workspace=path.join(dir,'workspace');await mkdir(workspace,{mode:0o777});await chmod(workspace,0o777);for(const [name,content] of Object.entries(item.files)){await mkdir(path.dirname(path.join(workspace,name)),{recursive:true,mode:0o777});await writeFile(path.join(workspace,name),content,{mode:0o666})}
  const config=path.join(dir,'config.json');await writeFile(config,JSON.stringify({profile:'coding',executionMode,endpoint,model,apiKey:key,saveApiKey:!!key,workspaceDir:workspace,maxSteps:12,mcpInitialized:true,mcpUrl:'',computerEnabled:false,telegramEnabled:false}),{mode:0o600});
  const port=await freePort();child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:config},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',d=>{errors=(errors+d).slice(-2000)});await Promise.race([new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))}),new Promise((_,reject)=>setTimeout(()=>reject(Error('server startup timeout')),15000).unref())]);
  const base=`http://127.0.0.1:${port}`,page=await(await fetch(base)).text(),auth=page.match(/name="diabolix-token" content="([^"]+)/)?.[1];if(!auth)throw Error('No local API token');const headers={'Content-Type':'application/json','X-Diabolix-Token':auth};const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error||'API error');return value};
  const run=await post('run',{message:item.task,session:'evaluation'});let events=[],done=false;
  while(Date.now()-started<timeout){const response=await fetch(base+'/api/events?id='+run.id,{headers});const result=await response.json();events=result.events||[];if(result.done){done=true;break}await new Promise(r=>setTimeout(r,250))}
  if(!done){await post('stop',{}).catch(()=>{});const until=Date.now()+10000;while(Date.now()<until){try{const state=await(await fetch(base+'/api/events?id='+run.id,{headers})).json();events=state.events||events;if(state.done)break}catch{break}await new Promise(r=>setTimeout(r,200))}return safeJournalEvent({id:item.id,fixture_hash:fixtureHash,status:'timeout',duration_ms:Date.now()-started,tool_calls:events.filter(e=>e.type==='tool_start').length,usage:events.filter(e=>e.type==='telemetry').at(-1)?.usage||null,events},[key])}
  let diff=null;try{const response=await fetch(base+'/api/changes?id='+run.id,{headers});if(response.ok)diff=(await response.json()).diff}catch{}
  let passed=true,reason='';try{await writeFile(path.join(workspace,'.diabolix-eval-check.mjs'),item.check,{mode:0o644,flag:'wx'});const check=await sandboxTool('run_command',{command:'node .diabolix-eval-check.mjs',timeout_ms:20000},workspace,new AbortController().signal);if(!check.endsWith('[код: 0]'))throw Error(check);const unchanged=path.join(workspace,'untouched.txt');if(!(await lstat(unchanged)).isFile()||await readFile(unchanged,'utf8')!==item.files['untouched.txt'])throw Error('Unrelated file changed')}catch(e){passed=false;reason=String(e.message).slice(0,1000)}
  const usage=events.filter(x=>x.type==='telemetry').at(-1)?.usage||null;
  const completed=events.some(e=>e.type==='done'),calls=events.filter(e=>e.type==='tool_start');return safeJournalEvent({id:item.id,fixture_hash:fixtureHash,status:passed?(completed?'passed':'review_failed'):'failed',check_passed:passed,duration_ms:Date.now()-started,agent_completed:completed,errors:events.filter(e=>e.type==='error').map(e=>e.text).slice(-3),tool_calls:calls.length,no_op_patches:calls.filter(e=>e.name==='patch_file'&&e.args?.target_content===e.args?.replacement_content).length,unrequested_test_calls:calls.filter(e=>e.name==='run_tests').length,usage,diff,events,...(reason?{reason}:{}),...(errors?{server_stderr:errors.slice(-500)}:{})},[key]);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,3000))])}await rm(dir,{recursive:true,force:true})}
}
const results=[];for(const item of chosen)for(let attempt=1;attempt<=repeats;attempt++){console.log('Running '+item.id+' ('+attempt+'/'+repeats+')');try{results.push({...await runCase(item),attempt})}catch(e){results.push({id:item.id,attempt,status:'error',reason:e.message})}{const {events,diff,...summary}=results.at(-1);console.log(JSON.stringify(summary))}}
const report={version:1,created_at:new Date().toISOString(),model,execution_mode:executionMode,endpoint:new URL(endpoint).origin,results,passed:results.filter(r=>r.status==='passed').length,total:results.length};const output=path.resolve(process.env.DIABOLIX_EVAL_OUTPUT||path.join(root,'.diabolix-eval-results',Date.now()+'.json'));await mkdir(path.dirname(output),{recursive:true,mode:0o700});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log('Report: '+output);if(report.passed!==report.total)process.exitCode=1;
