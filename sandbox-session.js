import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {protectedConfigMount} from './workspace-config.js';

const require=createRequire(import.meta.url);
const {isPackageInstall}=require('./sandbox/command-filter.cjs');
const image=process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local';
const MAX_OUTPUT=64*1024,MAX_PROCESSES=8,MAX_INPUT=8192;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// One isolated container per task, created only when a persistent process is
// requested. A foreground Docker client holds its stdin open; the entrypoint
// exits on EOF so a lost client does not intentionally leave an idle daemon.
export class SandboxSession {
 constructor(workspace,signal,{spawnCommand=spawn}={}){
  this.workspace=workspace;this.signal=signal;this.spawn=spawnCommand;this.name='diabolix-session-'+crypto.randomUUID();this.processes=new Map();this.container=null;this.starting=null;this.closing=null;this.closed=false;this.ready=false;this.cleanupConfirmed=false;
 }
 async open(){
  if(this.closed||this.signal.aborted)throw Error('Sandbox session has been stopped.');
  if(this.ready)return;
  if(this.starting)return this.starting;
  this.starting=this._open();try{await this.starting}finally{this.starting=null}
 }
 async _open(){
  const marker='DIABOLIX_READY_'+crypto.randomUUID();
  const source=`process.stdout.write(${JSON.stringify(marker+'\n')});process.stdin.resume();process.stdin.on('end',()=>process.exit(0));`;
  const args=['run','--rm','--init','-i','--name',this.name,'--label','io.diabolix.task-session=true','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount',`type=bind,src=${this.workspace},dst=/workspace`,...protectedConfigMount(this.workspace),'--workdir','/workspace','--entrypoint','node',image,'-e',source];
  const child=this.spawn('docker',args,{stdio:['pipe','pipe','pipe']});this.container=child;child.stdin.on('error',()=>{});let output='';
  await new Promise((resolve,reject)=>{let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);this.signal.removeEventListener('abort',abort);child.stdout.removeListener('data',stdout);if(error)reject(error);else resolve()};const stdout=chunk=>{output=(output+chunk.toString()).slice(-4000);if(output.includes(marker))finish()};const abort=()=>finish(Error('Sandbox session was cancelled.'));const timer=setTimeout(()=>finish(Error('Sandbox session startup timed out.')),20000);child.stdout.on('data',stdout);child.stderr.on('data',chunk=>{output=(output+chunk.toString()).slice(-4000)});child.once('error',error=>finish(Error('Unable to start sandbox session: '+error.message)));child.once('close',code=>{this.ready=false;finish(Error('Sandbox session exited before becoming ready (code '+code+'). '+output.slice(-500)))});this.signal.addEventListener('abort',abort,{once:true});if(this.signal.aborted)abort()});
  if(this.closed||this.signal.aborted)throw Error('Sandbox session was stopped during startup.');this.ready=true;
 }
 hasRunning(){return [...this.processes.values()].some(p=>p.status==='running');}
 // A process may leave descendants after docker exec has exited. Treat the
 // entire open container as potentially mutating until cleanup is confirmed.
 mayMutate(){return !!this.container&&!this.cleanupConfirmed;}
 async start(command,waitMs=1000){
  if(typeof command!=='string'||!command.trim()||command.length>12000)throw Error('Provide a nonempty command of at most 12000 characters.');
  if(isPackageInstall(command))throw Error('Use install_dependencies for npm or pip packages; this session has no network access.');
  if([...this.processes.values()].filter(p=>p.status==='running').length>=MAX_PROCESSES)throw Error('Too many active sandbox processes; stop the session before starting more.');
  if(this.processes.size>=64)throw Error('Process history is full; stop the sandbox session to start a fresh one.');
  await this.open();
  if(this.closed||this.signal.aborted)throw Error('Sandbox session has been stopped.');
  const id=crypto.randomUUID(),p={id,status:'running',exit_code:null,buffer:Buffer.alloc(0),offset:0,child:null};
  const args=['exec','-i','--workdir','/workspace','--env','HOME=/tmp','--env','TMPDIR=/tmp','--env','PATH=/workspace/.venv/bin:/workspace/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',this.name,'/bin/sh','-c',command];
  const child=this.spawn('docker',args,{stdio:['pipe','pipe','pipe']});p.child=child;this.processes.set(id,p);child.stdin.on('error',()=>{});
  const collect=chunk=>{const value=Buffer.from(chunk),all=Buffer.concat([p.buffer,value]);if(all.length>MAX_OUTPUT){const drop=all.length-MAX_OUTPUT;p.offset+=drop;p.buffer=all.subarray(drop)}else p.buffer=all};child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',error=>{p.status='error';p.error=error.message});child.once('close',(code,signal)=>{if(p.status!=='error')p.status='exited';p.exit_code=code;p.exit_signal=signal});
  await delay(Math.min(5000,Math.max(0,Number(waitMs)||0)));return this.read(id,0);
 }
 read(id,cursor=0){
  const p=this.processes.get(id);if(!p)throw Error('Unknown sandbox process.');if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('Invalid output cursor.');const start=Math.max(cursor,p.offset),end=p.offset+p.buffer.length;if(start>end)throw Error('Output cursor is beyond the retained output.');
  return {id:p.id,status:p.status,exit_code:p.exit_code,exit_signal:p.exit_signal||null,output:p.buffer.subarray(start-p.offset).toString('utf8'),next_cursor:end,truncated:cursor<p.offset,...(p.error?{error:p.error}:{})};
 }
 async readWait(id,cursor=0,waitMs=1000){
  if(!Number.isInteger(waitMs)||waitMs<0||waitMs>30000)throw Error('Invalid wait duration.');
  const until=Date.now()+waitMs;let result=this.read(id,cursor);
  while(result.status==='running'&&result.next_cursor===cursor&&Date.now()<until&&!this.signal.aborted){await delay(Math.min(100,Math.max(0,until-Date.now())));result=this.read(id,cursor)}
  if(this.signal.aborted)throw Error('Sandbox process observation cancelled.');return result;
 }
 write(id,text,{closeInput=false}={}){
  const p=this.processes.get(id);if(!p||p.status!=='running')throw Error('Sandbox process is not running.');if(typeof text!=='string'||Buffer.byteLength(text)>MAX_INPUT)throw Error('Input must be a string of at most 8192 bytes.');if(p.child.stdin.destroyed||p.child.stdin.writableEnded)throw Error('Sandbox process input is closed.');p.child.stdin.write(text);if(closeInput)p.child.stdin.end();return {id,status:p.status,input_closed:!!closeInput};
 }
 async close(){
  if(this.cleanupConfirmed)return;
  if(this.closing)return this.closing;
  this.closed=true;
  this.closing=this._close();
  try{await this.closing;this.cleanupConfirmed=true}finally{this.closing=null}
 }
 async _close(){
  if(!this.container)return;
  const child=this.container;child.stdin.end();
  if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('close',resolve)),delay(3000)]);
  // The Docker client exiting does not prove its container is gone. Always
  // query the daemon by the unique container name and allow retry on failure.
  const removed=await new Promise(resolve=>{let cleanup;try{cleanup=this.spawn('docker',['rm','--force',this.name],{stdio:['ignore','pipe','pipe']})}catch{return resolve(false)}let done=false,stderr='';const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok)};const timer=setTimeout(()=>{cleanup.kill('SIGKILL');finish(false)},5000);cleanup.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-2000)});cleanup.once('error',()=>finish(false));cleanup.once('close',code=>finish(code===0||code===1&&/no such (?:container|object)/i.test(stderr)))});
  if(!removed){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');throw Error('Could not confirm sandbox session cleanup for '+this.name+'.');}
  for(const p of this.processes.values())if(p.status==='running')p.child.kill('SIGKILL');this.ready=false;
 }
}
