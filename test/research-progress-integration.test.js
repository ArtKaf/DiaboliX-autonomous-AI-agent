import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port};
async function dockerAvailable(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}

test('Frontier can read many new windows and reread the same window after a change',{timeout:180000},async t=>{
 if(!await dockerAvailable())return t.skip('Docker daemon or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-research-progress-')),workspace=path.join(dir,'project');await chmod(dir,0o777);await mkdir(workspace,{mode:0o777});
 const content=Array.from({length:24},(_,i)=>`sample-line-${String(i+1).padStart(3,'0')}`).join('\n')+'\n';await writeFile(path.join(workspace,'many.txt'),content,{mode:0o666});await chmod(path.join(workspace,'many.txt'),0o666);
 let child,requests=0,observations=[];const provider=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests++;let message;
  if(requests===1){const toolCalls=Array.from({length:20},(_,i)=>({id:`read-${i+1}`,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'many.txt',start_line:i+1,end_line:i+1})}}));toolCalls.push({id:'duplicate',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'many.txt',start_line:20,end_line:20})}},{id:'patch',type:'function',function:{name:'patch_file',arguments:JSON.stringify({path:'many.txt',target_content:'sample-line-020',replacement_content:'sample-line-020-updated'})}},{id:'updated',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'many.txt',start_line:20,end_line:20})}});message={role:'assistant',content:null,tool_calls:toolCalls};}
  else{observations=data.messages.filter(m=>m.role==='tool');message={role:'assistant',content:'Read the requested windows and verified the edited line.'}}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.writeHead(500);res.end(String(error))}});
 const providerPort=await listen(provider),reservation=http.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
 t.after(async()=>{child?.kill('SIGTERM');await new Promise(resolve=>provider.close(resolve));await rm(dir,{recursive:true,force:true})});
 child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)?.[1];assert.ok(token);const headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)}),data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data};
 await post('config',{endpoint:`http://127.0.0.1:${providerPort}/v1`,model:'mock',workspace,maxSteps:8,mcpUrl:''});const started=await post('run',{message:'Inspect many sections of the file and update line 20'});let state;
 for(let i=0;i<7000;i++){const response=await fetch(base+'/api/events?id='+started.id,{headers});state=await response.json();if(state.done)break;await pause(20)}
 assert.ok(state?.done,'task did not finish');assert.ok(state.events.some(event=>event.type==='done'),JSON.stringify(state.events.filter(e=>['error','tool_result'].includes(e.type)).slice(-6)));assert.equal(requests,2);
 for(let i=1;i<=20;i++){const output=observations.find(m=>m.tool_call_id===`read-${i}`)?.content;assert.match(output||'',new RegExp(`sample-line-${String(i).padStart(3,'0')}`),`window ${i} was not read`)}
 assert.match(observations.find(m=>m.tool_call_id==='duplicate')?.content||'',/не менялся|повтор|unchanged|already|no new/i,'the duplicate read must report no new information');
 assert.match(observations.find(m=>m.tool_call_id==='updated')?.content||'',/sample-line-020-updated/);assert.match(await readFile(path.join(workspace,'many.txt'),'utf8'),/sample-line-020-updated/);
});
