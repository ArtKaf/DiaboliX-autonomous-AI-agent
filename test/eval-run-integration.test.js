import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const exec=promisify(execFile);

test('real evaluator records a reproducible manifest and runs an independent check using a mock provider', {timeout:120000}, async t=>{
 try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:5000,maxBuffer:2*1024*1024})}catch{t.skip('Docker sandbox image is unavailable');return}
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-eval-report-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let calls=0;const provider=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const request=JSON.parse(raw);calls++;const message=calls===1?{role:'assistant',content:null,tool_calls:[{id:'edit',type:'function',function:{name:'patch_file',arguments:JSON.stringify({path:'calculator.js',target_content:'return a - b;',replacement_content:'return a + b;'})}}]}:{role:'assistant',content:'Fixed.'};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message}],usage:{prompt_tokens:10,completion_tokens:3,prompt_tokens_details:{cached_tokens:2},cost:0.01,currency:'USD'}}))}catch{res.writeHead(500);res.end('{}')}});
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>provider.close());const endpoint=`http://127.0.0.1:${provider.address().port}/v1`,output=path.join(dir,'report.json'),secret='temporary-evaluation-secret';
 const child=spawn(process.execPath,['eval/run.js'],{cwd:process.cwd(),env:{...process.env,DIABOLIX_EVAL_ENDPOINT:endpoint,DIABOLIX_EVAL_MODEL:'mock',DIABOLIX_EVAL_MODEL_REVISION:'mock-v1',DIABOLIX_EVAL_API_KEY:secret,DIABOLIX_EVAL_CASE:'fix_calculation',DIABOLIX_EVAL_REPEATS:'1',DIABOLIX_EVAL_TIMEOUT_MS:'60000',DIABOLIX_EVAL_OUTPUT:output},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const [code]=await new Promise(resolve=>child.once('exit',(...args)=>resolve(args)));assert.equal(code,0,logs);const raw=await readFile(output,'utf8');assert.ok(!raw.includes(secret));const report=JSON.parse(raw);assert.equal(report.version,2);assert.equal(report.results[0].status,'passed');assert.equal(report.results[0].check_passed,true);assert.equal(report.manifest.conditions.model_revision,'mock-v1');assert.match(report.manifest.conditions.endpoint_sha256,/^[a-f0-9]{64}$/);assert.match(report.manifest.conditions.sandbox_image_id,/^sha256:[a-f0-9]{64}$/);assert.match(report.manifest.harness.source_sha256,/^[a-f0-9]{64}$/);assert.equal(typeof report.manifest.harness.source_changed_during_run,'boolean');assert.equal(report.manifest.fixtures[0].sha256,report.results[0].fixture_hash);assert.equal(report.results[0].usage.worker.prompt,20);assert.equal(report.results[0].usage.worker.provider_cost,0.02);assert.equal(calls,2);
});
