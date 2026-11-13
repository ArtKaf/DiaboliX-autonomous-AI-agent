'use strict';
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {chromium}=require('playwright-core');
async function main(){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('Слишком большой запрос');}const args=JSON.parse(input),url=new URL(args.url);
 if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||!url.port)throw Error('Разрешены только HTTP-адреса localhost или 127.0.0.1 с портом.');
 const origin=url.origin,output=[],logs=[],requests=[];let server, browser,page,screenshot=null;
 try{
  server=spawn('/bin/sh',['-c',args.server_command],{cwd:'/workspace',detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/workspace/.venv/bin:/workspace/node_modules/.bin:'+process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8'}});
  for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{if(output.join('').length<3000)output.push(b.toString().slice(0,1000))});
  let exited=null;server.on('exit',code=>{exited=code??1});server.on('error',e=>{exited=1;output.push(e.message)});
  let ready=false;const deadline=Date.now()+20000;while(Date.now()<deadline){if(exited!==null)throw Error('Сервер завершился до запуска: '+output.join('').slice(-1000));try{await fetch(url,{signal:AbortSignal.timeout(1000)});ready=true;break}catch{await delay(300)}}if(!ready)throw Error('Приложение не ответило на указанном локальном URL за 20 секунд.');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false});
  await context.route('**/*',route=>{try{const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue()}catch{}return route.abort()});
  page=await context.newPage();page.setDefaultTimeout(5000);page.on('console',m=>{if(m.type()==='error'&&logs.length<30)logs.push({type:'console_error',text:m.text().slice(0,500)})});page.on('pageerror',e=>{if(logs.length<30)logs.push({type:'page_error',text:e.message.slice(0,500)})});page.on('requestfailed',request=>{if(requests.length<30)requests.push({url:request.url().slice(0,500),error:request.failure()?.errorText||'failed'})});
  const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:10000});const results=[];
  for(const step of args.steps||[]){if(step.action==='click')await page.locator(step.selector).first().click();else if(step.action==='fill')await page.locator(step.selector).first().fill(step.value);else if(step.action==='expect_text'){const text=await page.locator(step.selector||'body').first().innerText();if(!text.includes(step.value))throw Error('Ожидаемый текст не найден: '+step.value)}else throw Error('Неизвестное действие браузерной проверки.');results.push({action:step.action,status:'passed'})}
  screenshot=(await page.screenshot({type:'png'})).toString('base64');console.log(JSON.stringify({ok:true,url:page.url(),title:await page.title(),http_status:response?.status()??null,steps:results,console_errors:logs,failed_requests:requests,screenshot,notice:'Only the supplied scenario was checked; a successful scenario does not establish overall application correctness.'}));
 }catch(e){if(page)try{screenshot=(await page.screenshot({type:'png'})).toString('base64')}catch{}console.log(JSON.stringify({ok:false,error:e.message.slice(0,1500),console_errors:logs,failed_requests:requests,server_output:output.join('').slice(-2000),screenshot}));process.exitCode=1}
 finally{if(browser)await browser.close().catch(()=>{});if(server?.pid)try{process.kill(-server.pid,'SIGKILL')}catch{}}
}
main().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1});
