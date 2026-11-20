import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,chmod,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {SandboxSession} from '../sandbox-session.js';
import {toolOutcome} from '../tool-outcome.js';
const exec=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));

async function available(){try{await exec('docker',['image','inspect',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'],{timeout:8000});await exec('docker',['info','--format','{{.ServerVersion}}'],{timeout:8000});return true}catch{return false}}
async function waitFor(session,id,expected,timeout=10000){let cursor=0,output='',last;const until=Date.now()+timeout;while(Date.now()<until){last=session.read(id,cursor);cursor=last.next_cursor;output+=last.output;if(expected(last,output))return {...last,output};await pause(100)}throw Error('Timed out waiting for sandbox process: '+JSON.stringify({last,output}))}

test('persistent sandbox processes share localhost, preserve streams and terminate with the task',{timeout:60000},async t=>{
 if(!await available())return t.skip('Docker or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-session-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));const controller=new AbortController(),session=new SandboxSession(dir,controller.signal);t.after(()=>session.close().catch(()=>{}));
 const server=await session.start("node -e 'require(\"http\").createServer((q,r)=>r.end(\"session-ok\")).listen(43891,\"127.0.0.1\",()=>console.log(\"ready\"))'",0);
 const ready=await waitFor(session,server.id,(_,output)=>output.includes('ready'));assert.equal(ready.status,'running');assert.equal(toolOutcome('process_read',{},JSON.stringify(ready)).status,'unknown');
 const client=await session.start("node -e 'fetch(\"http://127.0.0.1:43891\").then(r=>r.text()).then(console.log)'",0);const response=await waitFor(session,client.id,p=>p.status==='exited');assert.equal(response.exit_code,0);assert.match(response.output,/session-ok/);assert.equal(toolOutcome('process_read',{},JSON.stringify(response)).status,'success');
 await assert.rejects(session.start('npm install left-pad',0),/install_dependencies/);
 await session.close();assert.equal(session.closed,true);await assert.rejects(exec('docker',['inspect',session.name]));
});

test('persistent sandbox supports process input and bounds output',{timeout:60000},async t=>{
 if(!await available())return t.skip('Docker or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-session-input-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));const session=new SandboxSession(dir,new AbortController().signal);t.after(()=>session.close().catch(()=>{}));
 const process=await session.start("node -e 'process.stdin.on(\"data\",b=>{console.log(\"input:\"+b);process.exit(0)})'",0);await pause(300);session.write(process.id,'hello');const response=await waitFor(session,process.id,p=>p.status==='exited');assert.match(response.output,/input:hello/);assert.equal(response.exit_code,0);
 const flood=await session.start("node -e 'process.stdout.write(\"x\".repeat(100000))'",0);const large=await waitFor(session,flood.id,p=>p.status==='exited');const full=session.read(flood.id,0);assert.equal(full.truncated,true);assert.ok(Buffer.byteLength(full.output)<=65536);assert.equal(large.exit_code,0);
});

test('session remains potentially mutable after its foreground command leaves a background child',{timeout:60000},async t=>{
 if(!await available())return t.skip('Docker or sandbox image unavailable');
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-session-child-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));const session=new SandboxSession(dir,new AbortController().signal);t.after(()=>session.close().catch(()=>{}));
 const proc=await session.start('(sleep 2; printf after > /workspace/result.txt) >/dev/null 2>&1 &',1000);const done=await waitFor(session,proc.id,p=>p.status==='exited');assert.equal(done.exit_code,0);assert.equal(session.hasRunning(),false);assert.equal(session.mayMutate(),true);
 await pause(2000);const {readFile}=await import('node:fs/promises');assert.equal(await readFile(path.join(dir,'result.txt'),'utf8'),'after');await session.close();assert.equal(session.mayMutate(),false);
});
test('failed cleanup remains unconfirmed and a later close retries Docker removal',async()=>{
 const {EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');let attempts=0;
 const spawnMock=()=>{const child=new EventEmitter();child.stderr=new PassThrough();child.kill=()=>{};process.nextTick(()=>{attempts++;if(attempts===1){child.stderr.write('Cannot connect to Docker daemon');child.emit('close',1)}else child.emit('close',0)});return child};
 const session=new SandboxSession('/unused',new AbortController().signal,{spawnCommand:spawnMock});session.container={stdin:{end(){}},exitCode:0,signalCode:null};session.ready=true;
 await assert.rejects(session.close(),/Could not confirm/);assert.equal(session.mayMutate(),true);assert.equal(session.cleanupConfirmed,false);await session.close();assert.equal(attempts,2);assert.equal(session.cleanupConfirmed,true);assert.equal(session.mayMutate(),false);
});
