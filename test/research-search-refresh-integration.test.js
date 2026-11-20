import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,chmod,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port};
async function dockerAvailable(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}

test('Frontier reexecutes identical search after an external change and resets stalled progress',{timeout:180000},async t=>{
 if(!await dockerAvailable())return t.skip('Docker daemon or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-search-refresh-')),workspace=path.join(dir,'project');await chmod(dir,0o777);await mkdir(workspace,{mode:0o777});const file=path.join(workspace,'source.txt');await writeFile(file,'first version\n',{mode:0o666});await chmod(file,0o666);
 const needle='unique_search_refresh_72910';let child,requests=0;const captured=[];
 const provider=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests++;const previous=data.messages.findLast(m=>m.role==='tool');if(previous)captured.push({id:previous.tool_call_id,content:previous.content});
  if(requests===6)await writeFile(file,`first version\n${needle}\n`);
  const message=requests<=10?{role:'assistant',content:null,tool_calls:[{id:`search-${requests}`,type:'function',function:{name:'search_code',arguments:JSON.stringify({query:needle})}}]}:{role:'assistant',content:'The workspace search was inspected.'};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}]}));
 }catch(error){res.writeHead(500);res.end(String(error))}});
 const providerPort=await listen(provider),reservation=http.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
 t.after(async()=>{child?.kill('SIGTERM');await new Promise(resolve=>provider.close(resolve));await rm(dir,{recursive:true,force:true})});
 child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(dir,'config.local.json')}});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base=`http://127.0.0.1:${port}`,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)?.[1];assert.ok(token);const headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 const post=async(route,body)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)}),data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data};
 await post('config',{endpoint:`http://127.0.0.1:${providerPort}/v1`,model:'mock',workspace,maxSteps:20,mcpUrl:''});const started=await post('run',{message:'Inspect the workspace search results'});let state;
 for(let i=0;i<7000;i++){state=await(await fetch(base+'/api/events?id='+started.id,{headers})).json();if(state.done)break;await pause(20)}
 assert.ok(state?.done,'task did not finish');assert.ok(state.events.some(event=>event.type==='done'),JSON.stringify(state.events.filter(e=>['error','tool_result'].includes(e.type)).slice(-8)));assert.equal(requests,11);
 assert.match(captured.find(x=>x.id==='search-5')?.content||'',/Совпадений не найдено/);
 const changed=captured.find(x=>x.id==='search-6')?.content||'';assert.match(changed,new RegExp(needle));assert.doesNotMatch(changed,/Повторные результаты исследования/,'new content resets the no-progress warning');
 assert.match(captured.find(x=>x.id==='search-10')?.content||'',new RegExp(needle));
});
