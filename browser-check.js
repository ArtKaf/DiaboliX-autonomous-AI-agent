import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {protectedConfigMount} from './workspace-config.js';
import shell from './sandbox/command-filter.cjs';
const image=process.env.DIABOLIX_COMPUTER_IMAGE||'diabolix-computer:local';
export function explicitlyForbidsTests(task){const text=String(task||'').toLowerCase();return /(?:не\s+(?:надо\s+|нужно\s+)?(?:запускай|запускать|проверяй|проверять|тестируй|тестировать)|без)\s+(?:никаких?\s+)?(?:автоматических?\s+)?(?:тест|провер)|(?:do not|don't|never|without)\s+(?:(?:run|use)\s+)?(?:automated\s+)?tests?/.test(text)}
export function explicitlyForbidsBrowserCheck(task){const text=String(task||'').toLowerCase();return explicitlyForbidsTests(text)||/(?:не\s+(?:надо\s+|нужно\s+)?(?:используй|использовать|открывай|открывать|запускай|запускать)|без)\s+(?:никаких?\s+)?браузер|(?:do not|don't|never|without)\s+(?:(?:run|use|open)\s+)?(?:(?:a|the)\s+)?browser/.test(text)}
export async function browserTest(args,workspace,signal,{networkContainer}={}){
 if(args.use_existing_server===true){if(typeof networkContainer!=='string'||!/^diabolix-session-[a-f0-9-]{36}$/.test(networkContainer))throw Error('Нет активной сетевой песочницы с работающим приложением.');if(args.server_command!==undefined&&args.server_command!=='')throw Error('Не указывайте server_command при подключении к существующему серверу.');}
 else {if(typeof args.server_command!=='string'||!args.server_command.trim()||args.server_command.length>2000)throw Error('Укажите команду запуска локального приложения.');if(shell.isPackageInstall(args.server_command))throw Error('Для установки зависимостей используйте install_dependencies до браузерной проверки.');}
 let url;try{url=new URL(args.url)}catch{throw Error('Укажите корректный локальный URL.')}if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||!url.port||url.username||url.password)throw Error('Разрешён только HTTP localhost или 127.0.0.1 с портом.');
 if(args.expected_status!==undefined&&(!Number.isInteger(args.expected_status)||args.expected_status<100||args.expected_status>599))throw Error('Некорректный ожидаемый HTTP-статус.');
 if(!Array.isArray(args.steps)||args.steps.length>20)throw Error('Укажите не более 20 шагов.');
 const selectorActions=['click','fill','expect_text','wait_visible','expect_visible','expect_hidden','expect_value'];
 const valueActions=['fill','expect_text','expect_value','goto','expect_url'];
 for(const step of args.steps){
  if(!step||typeof step!=='object'||!['goto','expect_url',...selectorActions].includes(step.action)||
   (selectorActions.includes(step.action)&&(typeof step.selector!=='string'||!step.selector||step.selector.length>500))||
   (valueActions.includes(step.action)&&(typeof step.value!=='string'||step.value.length>2000||(['goto','expect_url'].includes(step.action)&&!step.value))))throw Error('Некорректный шаг проверки: укажите action, selector и при необходимости value.');
  if(step.expected_status!==undefined&&(step.action!=='goto'||!Number.isInteger(step.expected_status)||step.expected_status<100||step.expected_status>599))throw Error('Ожидаемый HTTP-статус допустим только для goto.');
  if(['goto','expect_url'].includes(step.action)){let target;try{target=new URL(step.value,url)}catch{throw Error('Некорректный URL шага браузерной проверки.')}if(target.origin!==url.origin||target.username||target.password)throw Error('Переходы браузерной проверки разрешены только в пределах исходного localhost origin.');}
 }
 if(signal.aborted)throw Error('Остановлено');const name='diabolix-browser-test-'+crypto.randomUUID();
 return await new Promise((resolve,reject)=>{
  const argv=['run','--rm','-i','--name',name,'--network',args.use_existing_server===true?'container:'+networkContainer:'none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--shm-size','256m','--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--mount',`type=bind,src=${workspace},dst=/workspace`,...protectedConfigMount(workspace),'--workdir','/workspace','--entrypoint','node',image,'/opt/diabolix/browser-check.cjs'];
  const child=spawn('docker',argv,{stdio:['pipe','pipe','pipe']});let output='',errors='',done=false,timedOut=false,cleanup;
  const stop=()=>{cleanup??=new Promise(r=>{const c=spawn('docker',['rm','-f',name],{stdio:'ignore'});const timer=setTimeout(()=>c.kill('SIGKILL'),5000);c.on('close',()=>{clearTimeout(timer);r()});c.on('error',()=>{clearTimeout(timer);r()})});child.kill('SIGKILL')};
  const timer=setTimeout(()=>{timedOut=true;stop()},60000);const abort=()=>stop();signal.addEventListener('abort',abort,{once:true});child.stdout.on('data',b=>{output+=b.toString();if(output.length>4000000)stop()});child.stderr.on('data',b=>{if(errors.length<4000)errors+=b.toString()});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));
  const finish=async(err)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(cleanup)await cleanup;if(signal.aborted)return reject(Error('Остановлено'));if(timedOut)return reject(Error('Браузерная проверка превысила 60 секунд.'));if(err)return reject(err);try{const result=JSON.parse(output);if(typeof result.ok!=='boolean')throw Error('Некорректный ответ');resolve(result)}catch{return reject(Error('Браузерная проверка не вернула результат: '+errors.slice(0,1000)))}};
  child.on('error',finish);child.on('close',()=>finish());
 });
}
