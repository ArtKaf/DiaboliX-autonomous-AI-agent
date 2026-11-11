import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
const image=process.env.DIABOLIX_SANDBOX_IMAGE || 'diabolix-sandbox:local';
export function sandboxTool(name,args,workspace,signal,maxOutput=24000) {
 return new Promise((resolve,reject)=>{
  if(signal.aborted)return reject(Error('Остановлено'));
  const container='diabolix-'+crypto.randomUUID();
  const dockerArgs=['run','--rm','-i','--name',container,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount',`type=bind,src=${workspace},dst=/workspace`,'--workdir','/workspace',image];
  const child=spawn('docker',dockerArgs,{stdio:['pipe','pipe','pipe']}); let output='',timedOut=false,finished=false;
  const cleanup=()=>{const c=spawn('docker',['rm','-f',container],{stdio:'ignore'});c.on('error',()=>{});};
  const abort=()=>{cleanup();child.kill('SIGKILL')}; signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;abort()},Math.min(Math.max(Number(args.timeout_ms)||30000,1000),120000));
  const collect=d=>{if(output.length<maxOutput+16000)output+=d.toString()};child.stdout.on('data',collect);child.stderr.on('data',collect);child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({name,args}));
  const done=(err,code)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(err)return reject(Error(`Docker недоступен: ${err.message}`));if(signal.aborted)return reject(Error('Остановлено'));resolve(output.slice(0,maxOutput)+`\n[код: ${code ?? 'нет'}${timedOut?', тайм-аут':''}]`)};
  child.on('error',e=>done(e));child.on('close',code=>done(null,code));
 });
}
