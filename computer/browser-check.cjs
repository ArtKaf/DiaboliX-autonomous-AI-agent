'use strict';
const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {chromium}=require('playwright-core');
const stepTimeout=5000;
function sameOrigin(value,base){
 const target=new URL(value,base);
 if(target.origin!==base.origin||target.username||target.password)throw Error('Переходы браузерной проверки разрешены только в пределах исходного localhost origin.');
 return target.href;
}
function assertNavigation(response,expected,{allowNoResponse=false}={}){
 if(!response){if(allowNoResponse&&expected===undefined)return;throw Error('Основная навигация не вернула HTTP-ответ.')}
 const status=response.status();if(expected!==undefined&&status!==expected)throw Error(`Ожидался HTTP ${expected}, получен HTTP ${status}.`);
 if(expected===undefined&&status>=400)throw Error(`Основная навигация вернула HTTP ${status}.`);
}
async function waitForText(locator,value){
 const deadline=Date.now()+stepTimeout;let last='';
 while(Date.now()<deadline){
  try{last=await locator.innerText({timeout:Math.max(1,deadline-Date.now())});if(last.includes(value))return;}catch(error){if(Date.now()>=deadline)break;}
  await delay(Math.min(100,Math.max(1,deadline-Date.now())));
 }
 throw Error('Ожидаемый текст не найден: '+value);
}
async function main(){
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100000)throw Error('Слишком большой запрос');}const args=JSON.parse(input),url=new URL(args.url);
 if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||!url.port)throw Error('Разрешены только HTTP-адреса localhost или 127.0.0.1 с портом.');
 const origin=url.origin,output=[],logs=[],requests=[],httpFailures=[],results=[],navigations=[];let server,browser,page,screenshot=null,response=null;
 try{
  let exited=null;
  if(args.use_existing_server!==true){
   server=spawn('/bin/sh',['-c',args.server_command],{cwd:'/workspace',detached:true,stdio:['ignore','pipe','pipe'],env:{PATH:'/workspace/.venv/bin:/workspace/node_modules/.bin:'+process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',LANG:'C.UTF-8'}});
   for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{if(output.join('').length<3000)output.push(b.toString().slice(0,1000))});
   server.on('exit',code=>{exited=code??1});server.on('error',e=>{exited=1;output.push(e.message)});
  }
  let ready=false;const deadline=Date.now()+20000;while(Date.now()<deadline){if(exited!==null)throw Error('Сервер завершился до запуска: '+output.join('').slice(-1000));try{await fetch(url,{signal:AbortSignal.timeout(1000)});ready=true;break}catch{await delay(300)}}if(!ready)throw Error('Приложение не ответило на указанном локальном URL за 20 секунд.');
  browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false});
  await context.route('**/*',route=>{try{const u=new URL(route.request().url());if(u.origin===origin||['data:','blob:'].includes(u.protocol))return route.continue()}catch{}return route.abort()});
  page=await context.newPage();page.setDefaultTimeout(stepTimeout);page.on('console',m=>{if(m.type()==='error'&&logs.length<30)logs.push({type:'console_error',text:m.text().slice(0,500)})});page.on('pageerror',e=>{if(logs.length<30)logs.push({type:'page_error',text:e.message.slice(0,500)})});page.on('requestfailed',request=>{if(requests.length<30)requests.push({url:request.url().slice(0,500),error:request.failure()?.errorText||'failed'})});page.on('response',r=>{if(r.status()>=400&&httpFailures.length<30)httpFailures.push({url:r.url().slice(0,500),status:r.status()})});
  response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:10000});navigations.push({url:page.url(),status:response?.status()??null});assertNavigation(response,args.expected_status);
  for(const [index,step] of (args.steps||[]).entries()){
   const started=Date.now();
   try{
    const locator=step.selector?page.locator(step.selector).first():null;
    if(step.action==='click')await locator.click();
    else if(step.action==='fill')await locator.fill(step.value);
    else if(step.action==='wait_visible'||step.action==='expect_visible')await locator.waitFor({state:'visible'});
    else if(step.action==='expect_hidden')await locator.waitFor({state:'hidden'});
    else if(step.action==='expect_text')await waitForText(locator,step.value);
    else if(step.action==='expect_value'){
     const deadline=Date.now()+stepTimeout;let matched=false;
     while(Date.now()<deadline){try{const actual=await locator.inputValue({timeout:Math.max(1,deadline-Date.now())});if(actual===step.value){matched=true;break}}catch(error){if(Date.now()>=deadline)break}await delay(Math.min(100,Math.max(1,deadline-Date.now())))}
     if(!matched)throw Error('Ожидаемое значение поля не найдено.');
    }
    else if(step.action==='goto'){response=await page.goto(sameOrigin(step.value,url),{waitUntil:'domcontentloaded',timeout:10000});navigations.push({url:page.url(),status:response?.status()??null});assertNavigation(response,step.expected_status,{allowNoResponse:true});}
    else if(step.action==='expect_url')await page.waitForURL(sameOrigin(step.value,url),{timeout:stepTimeout});
    else throw Error('Неизвестное действие браузерной проверки.');
    results.push({index:index+1,action:step.action,status:'passed',url:page.url(),duration_ms:Date.now()-started});
   }catch(e){results.push({index:index+1,action:step.action,status:'failed',url:page.url(),duration_ms:Date.now()-started,error:String(e.message).slice(0,1000)});throw e;}
  }
  screenshot=(await page.screenshot({type:'png'})).toString('base64');console.log(JSON.stringify({ok:true,url:page.url(),title:await page.title(),http_status:navigations[0]?.status??null,navigations,steps:results,console_errors:logs,failed_requests:requests,http_failures:httpFailures,screenshot,notice:'Only the supplied scenario was checked; a successful scenario does not establish overall application correctness.'}));
 }catch(e){if(page)try{screenshot=(await page.screenshot({type:'png'})).toString('base64')}catch{}console.log(JSON.stringify({ok:false,error:e.message.slice(0,1500),url:page?.url()??null,steps:results,navigations,console_errors:logs,failed_requests:requests,http_failures:httpFailures,server_output:output.join('').slice(-2000),screenshot}));process.exitCode=1}
 finally{if(browser)await browser.close().catch(()=>{});if(server?.pid)try{process.kill(-server.pid,'SIGKILL')}catch{}}
}
main().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message}));process.exitCode=1});
