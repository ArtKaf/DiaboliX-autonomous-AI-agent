import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import {protectedConfigMount} from './workspace-config.js';
import {withPackageNetwork} from './package-network.js';
import {installFailureHint} from './command-hints.js';
const image=process.env.DIABOLIX_SANDBOX_IMAGE || 'diabolix-sandbox:local';
export function checkDocker(signal,{timeoutMs=8000,spawnCommand=spawn}={}) {
 return new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(Error('Остановлено'));
  const child=spawnCommand('docker',['info','--format','{{.ServerVersion}}'],{stdio:['ignore','pipe','pipe']});let output='',errorOutput='',finished=false,timedOut=false;
  const abort=()=>child.kill('SIGKILL');signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},timeoutMs);
  child.stdout.on('data',data=>{output=(output+data).slice(0,1000)});child.stderr.on('data',data=>{errorOutput=(errorOutput+data).slice(0,1000)});
  const done=(err,code)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(signal.aborted)return reject(Error('Остановлено'));if(timedOut)return reject(Error(`Docker не ответил за ${Math.ceil(timeoutMs/1000)} с. Проверьте Docker Desktop и дождитесь его запуска; песочница не запущена.`));if(err||code!==0||!output.trim())return reject(Error(`Docker недоступен. Проверьте Docker Desktop и подключение к движку.${errorOutput.trim()?' '+errorOutput.trim():err?' '+err.message:''}`));resolve()};
  child.on('error',err=>done(err));child.on('close',code=>done(null,code));
 });
}
export function sandboxTool(name,args,workspace,signal,maxOutput=24000) {
 if(name==='install_dependencies')return withPackageNetwork(image,signal,network=>runDockerTool(name,args,workspace,signal,maxOutput,network));
 return runDockerTool(name,args,workspace,signal,maxOutput);
}
function runDockerTool(name,args,workspace,signal,maxOutput,{network='none',proxyUrl='',secret=''}={}) {
 return new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(Error('Остановлено'));
  const container='diabolix-'+crypto.randomUUID();
  const dockerArgs=['run','--rm','-i','--name',container,'--network',network,...(proxyUrl?['--dns','127.0.0.1','--env',`DIABOLIX_PACKAGE_PROXY=${proxyUrl}`]:[]),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--cpus','2','--tmpfs',`/tmp:rw,nosuid,nodev,size=${proxyUrl?'1g':'256m'}`,'--mount',`type=bind,src=${workspace},dst=/workspace`,...protectedConfigMount(workspace),'--workdir','/workspace',image];
  const child=spawn('docker',dockerArgs,{stdio:['pipe','pipe','pipe']}); let output='',timedOut=false,finished=false,cleanupPromise;
  const cleanup=()=>cleanupPromise??=new Promise(resolve=>{const c=spawn('docker',['rm','-f',container],{stdio:'ignore'});const timer=setTimeout(()=>c.kill('SIGKILL'),5000);timer.unref();const done=()=>{clearTimeout(timer);resolve()};c.on('error',done);c.on('close',done)});
  const abort=()=>{cleanup();child.kill('SIGKILL')}; signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;abort()},Math.min(Math.max(Number(args.timeout_ms)||(proxyUrl?300000:30000),1000),proxyUrl?600000:120000));
  const collect=d=>{if(output.length<maxOutput+16000)output+=d.toString()};child.stdout.on('data',collect);child.stderr.on('data',collect);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({name,args}));
  const done=async(err,code)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(cleanupPromise)await cleanupPromise;if(err)return reject(Error(`Docker недоступен: ${err.message}`));if(signal.aborted)return reject(Error('Остановлено'));const hint=timedOut?`\nТайм-аут инструмента ${name} в Docker-песочнице. Проверьте состояние Docker Desktop и длительность операции.`:'';const sanitized=secret?output.replaceAll(secret,'[скрыто]').replaceAll(Buffer.from('diabolix:'+secret).toString('base64'),'[скрыто]'):output;const installHint=installFailureHint(name,args,{code,timedOut,output:sanitized});resolve(sanitized.slice(0,maxOutput)+(sanitized.length>maxOutput?'\n…[вывод сокращён]':'')+hint+`\n[код: ${code ?? 'нет'}${timedOut?', тайм-аут':''}]`+(installHint?'\n'+installHint:''))};
  child.on('error',e=>done(e));child.on('close',code=>done(null,code));
 });
}
