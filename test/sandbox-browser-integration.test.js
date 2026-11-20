import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {SandboxSession} from '../sandbox-session.js';
import {browserTest} from '../browser-check.js';
const exec=promisify(execFile);

test('browser checks an existing server in the task-scoped offline network',{timeout:90000},async t=>{
 try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['image','inspect',process.env.DIABOLIX_COMPUTER_IMAGE||'diabolix-computer:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000})}catch{return t.skip('Docker or required images unavailable')}
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-attached-browser-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'app.cjs'),`const http=require('http');http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/second'?'<h1>Second page</h1>':'<a href="/second">Go</a>')}).listen(43919,'127.0.0.1',()=>console.log('ready'))`,{mode:0o666});
 const controller=new AbortController(),session=new SandboxSession(dir,controller.signal);t.after(()=>session.close().catch(()=>{}));const started=await session.start('node app.cjs',1000);assert.equal(started.status,'running');const network=await exec('docker',['inspect','--format','{{.HostConfig.NetworkMode}}',session.name]);assert.equal(network.stdout.trim(),'none');
 const result=await browserTest({use_existing_server:true,url:'http://127.0.0.1:43919/',steps:[{action:'click',selector:'a'},{action:'expect_text',selector:'h1',value:'Second page'}]},dir,controller.signal,{networkContainer:session.name});assert.equal(result.ok,true,JSON.stringify({...result,screenshot:undefined}));assert.equal(result.steps.length,2);assert.equal(session.hasRunning(),true);await session.close();await assert.rejects(exec('docker',['inspect',session.name]));
 await assert.rejects(browserTest({use_existing_server:true,url:'http://127.0.0.1:43919/',steps:[]},dir,controller.signal,{networkContainer:'untrusted-container'}),/песочниц/);
});
