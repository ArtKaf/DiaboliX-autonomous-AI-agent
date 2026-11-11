import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function listen(server) { await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); return server.address().port; }
test('model discovery and agent tool loop', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-test-')); t.after(()=>rm(dir,{recursive:true,force:true})); await chmod(dir,0o777);
  let calls=0;
  const provider=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'test-model'}]}));let input='';for await(const c of req)input+=c;const data=JSON.parse(input);calls++;assert.match(data.messages[0].content,/Docker container/);
    let message;if(calls===1)message={role:'assistant',content:'План'};else if(calls===6)message={role:'assistant',content:'Проверка'};else if([2,3,4].includes(calls)){const name=calls===3?'write_file':'run_tests';const args=calls===3?{path:'hello.txt',content:'hello'}:{command:'true'};message={role:'assistant',content:null,tool_calls:[{id:'call-'+calls,type:'function',function:{name,arguments:JSON.stringify(args)}}]};}else message={role:'assistant',content:'Готово'};res.end(JSON.stringify({choices:[{message}]}));});
  const providerPort=await listen(provider); t.after(()=>provider.close());
  const reservation=http.createServer(); const port=await listen(reservation); await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)}}); t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error(`server exited ${code}`)));});
  const base=`http://127.0.0.1:${port}`; const html=await (await fetch(base)).text(); const token=html.match(/name="diabolix-token" content="([^"]+)/)[1];
  const headers={'Content-Type':'application/json','X-Diabolix-Token':token}; const post=(route,data={})=>fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(data)}).then(r=>r.json());
  assert.equal((await fetch(base+'/api/config')).status,403);
  assert.equal((await post('config',{endpoint:`http://127.0.0.1:${providerPort}/v1`,model:'test-model',workspace:dir,maxSteps:5})).ok,true);
  assert.deepEqual((await post('models')).models,['test-model']);
  const run=await post('run',{message:'Создай файл',session:'test'}); let result;
  for(let i=0;i<3000;i++){result=await (await fetch(base+'/api/events?id='+run.id,{headers})).json();if(result.done)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(result.done,true); assert.ok(result.events.some(e=>e.type==='tool_result')); assert.ok(result.events.some(e=>e.type==='message'&&e.text==='Готово')); assert.ok(result.events.some(e=>e.type==='message'&&e.text.includes('Рецензент'))); assert.equal(await readFile(path.join(dir,'hello.txt'),'utf8'),'hello');
});
