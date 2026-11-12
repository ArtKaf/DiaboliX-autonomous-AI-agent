import {spawn} from 'node:child_process';
import crypto from 'node:crypto';

function docker(args,{signal,timeout=20000,secret=''}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('Остановлено'));
  const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});let out='',err='',timedOut=false,finished=false;
  const abort=()=>child.kill('SIGKILL');signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;abort()},timeout);
  child.stdout.on('data',d=>{out=(out+d).slice(0,4000)});child.stderr.on('data',d=>{err=(err+d).slice(0,4000)});
  const done=(error,code)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(Error('Остановлено'));if(error||code!==0){let message=timedOut?'Истекло время ожидания Docker':(err.trim()||error?.message||`Docker завершился с кодом ${code}`);if(secret)message=message.replaceAll(secret,'[скрыто]');return reject(Error(message))}resolve(out.trim())};
  child.on('error',e=>done(e));child.on('close',code=>done(null,code));
 });
}

// The installer has only an isolated internal network. A separate, unprivileged
// container proxies HTTPS to three public registries and has no project mount.
export async function withPackageNetwork(image,signal,run){
 const suffix=crypto.randomUUID(),network='diabolix-packages-'+suffix,proxy='diabolix-registry-'+suffix,secret=crypto.randomBytes(32).toString('hex');
 try{
  await docker(['network','create','--internal','--opt','com.docker.network.bridge.gateway_mode_ipv4=isolated','--label','com.diabolix.ephemeral=true',network],{signal});
  const info=JSON.parse(await docker(['network','inspect',network,'--format','{{json .}}'],{signal}));
  if(info.Internal!==true||info.Options?.['com.docker.network.bridge.gateway_mode_ipv4']!=='isolated')throw Error('Docker не подтвердил изолированную сеть установки.');
  await docker(['run','-d','--rm','--pull','never','--name',proxy,'--label','com.diabolix.ephemeral=true','--network','bridge','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','32','--memory','192m','--cpus','0.5','--env',`DIABOLIX_PROXY_SECRET=${secret}`,'--entrypoint','node',image,'/opt/diabolix/install-proxy.cjs'],{signal,secret,timeout:30000});
  await docker(['network','connect',network,proxy],{signal});
  const networks=JSON.parse(await docker(['inspect',proxy,'--format','{{json .NetworkSettings.Networks}}'],{signal}));const address=networks[network]?.IPAddress;
  if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address||''))throw Error('Не удалось определить адрес прокси установки.');
  return await run({network,proxyUrl:`http://diabolix:${secret}@${address}:3128`,secret});
 }catch(e){if(signal?.aborted)throw Error('Остановлено');throw Error('Не удалось запустить изолированную установку зависимостей: '+e.message)}
 finally{await docker(['rm','-f',proxy],{timeout:10000,secret}).catch(()=>{});await docker(['network','rm',network],{timeout:10000,secret}).catch(()=>{})}
}
