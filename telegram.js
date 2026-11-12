import {setTimeout as delay} from 'node:timers/promises';
import crypto from 'node:crypto';

export function validTelegramId(id){return typeof id==='string'&&/^[1-9]\d{0,15}$/.test(id)&&BigInt(id)<=4503599627370495n;}
export function validTelegramToken(token){return typeof token==='string'&&/^\d{1,20}:[A-Za-z0-9_-]{10,200}$/.test(token);}

function apiTransport(token){
  const base=`https://api.telegram.org/bot${token}/`;
  return async(method,body,signal)=>{
    let response;
    try{response=await fetch(base+method,{method:'POST',...(body instanceof FormData?{body}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.any([signal,AbortSignal.timeout(method==='getUpdates'?40000:30000)])});}
    catch{throw Error('Не удалось связаться с Telegram API');}
    let data;try{data=await response.json()}catch{throw Error(`Некорректный ответ Telegram API (HTTP ${response.status})`)}
    if(!response.ok||!data.ok){const error=Error(`Ошибка Telegram API (HTTP ${response.status}, код ${Number(data.error_code)||'неизвестен'})`);error.status=response.status;error.retryAfter=Number(data.parameters?.retry_after)||1;throw error;}
    return data.result;
  };
}
const HELP=`DiaboliX · управление в личном чате\n\nНапишите задачу обычным сообщением или /task текст.\n/status — состояние задачи и настройки\n/logs — скачать журнал и результаты инструментов\n/stop — остановить задачу\n/new — новая сессия\n/changes — скачать diff текущей задачи\n/screen — снимок рабочего стола\n/rollback — откатить изменения завершённой задачи\n/models — список моделей\n/settings — настройки без ключей\n/set имя значение — изменить настройку\n/help — эта справка\n\nДоступные имена /set: profile (coding или trading), endpoint, model, plannerModel, workerModel, reviewerModel, reasoningEffort, plannerReasoningEffort, workerReasoningEffort, reviewerReasoningEffort, workspace, maxSteps, unlimitedSteps, contextLimit, computerEnabled, computerNetworkEnabled, mcpUrl, searchProvider, apiKey, braveApiKey, tavilyApiKey, saveApiKey, saveBraveApiKey, saveTavilyApiKey. Используйте /set имя - чтобы очистить значение. Ключи, введённые в Telegram, остаются в истории этого чата.`;
const BOOL_KEYS=new Set(['unlimitedSteps','computerEnabled','computerNetworkEnabled','saveApiKey','saveBraveApiKey','saveTavilyApiKey']);
const NUMBER_KEYS=new Set(['maxSteps','contextLimit']);
const STRING_KEYS=new Set(['profile','endpoint','model','plannerModel','workerModel','reviewerModel','reasoningEffort','plannerReasoningEffort','workerReasoningEffort','reviewerReasoningEffort','workspace','mcpUrl','searchProvider','apiKey','braveApiKey','tavilyApiKey']);
export function parseTelegramSetting(input){
  const match=input.match(/^(\S+)\s+([\s\S]+)$/);if(!match)throw Error('Формат: /set имя значение');
  const [,key,raw]=match;let value=raw.trim();if(value==='-')value='';
  if(BOOL_KEYS.has(key)){if(!['true','false','on','off','1','0'].includes(value.toLowerCase()))throw Error('Используйте true или false');value=['true','on','1'].includes(value.toLowerCase());}
  else if(NUMBER_KEYS.has(key)){if(!/^\d+$/.test(value))throw Error('Укажите целое число');value=Number(value);if(!Number.isSafeInteger(value)||(key==='maxSteps'&&(value<1||value>100))||(key==='contextLimit'&&(value<1000||value>1000000)))throw Error('Значение вне допустимого диапазона');}
  else if(!STRING_KEYS.has(key))throw Error('Неизвестная настройка. Список: /help');
  if(key==='searchProvider'&&!['auto','tavily','brave'].includes(value))throw Error('Укажите auto, tavily или brave');
  if(key==='profile'&&!['coding','trading'].includes(value))throw Error('Укажите coding или trading');
  return {[key]:value};
}

export class TelegramBridge {
  constructor({token,userId,handlers,request,now=()=>Date.now(),wait=delay}){
    if(!validTelegramToken(token)||!validTelegramId(userId))throw Error('Укажите корректный токен бота и Telegram ID');
    this.token=token;this.userId=userId;this.handlers=handlers;this.request=request||apiTransport(token);this.now=now;this.wait=wait;this.controller=new AbortController();this.status={state:'connecting'};this.startedAt=Math.floor(now()/1000);this.offset=0;this.queue=Promise.resolve();this.incoming=Promise.resolve();this.queued=0;this.dropped=0;this.session=`telegram:${userId}:${crypto.randomUUID()}`;
  }
  async call(method,body){return this.request(method,body,this.controller.signal);}
  async deliver(method,body){for(let attempt=0;;attempt++){try{return await this.call(method,body)}catch(e){if(e.status!==429||attempt>=3||this.controller.signal.aborted)throw e;await this.wait(Math.min(60,Math.max(1,e.retryAfter||1))*1000,undefined,{signal:this.controller.signal});}}}
  async start(){
    while(!this.controller.signal.aborted){try{
      const bot=await this.call('getMe',{});const webhook=await this.call('getWebhookInfo',{});
      if(webhook?.url)throw Error('У бота уже настроен webhook. Для long polling отключите его в настройках бота.');
      this.status={state:'connected',username:bot.username||''};
      while(!this.controller.signal.aborted){const updates=await this.call('getUpdates',{offset:this.offset,timeout:25,allowed_updates:['message']});this.status={state:'connected',username:bot.username||''};for(const update of updates||[]){if(!Number.isSafeInteger(update.update_id)||update.update_id<this.offset)continue;this.offset=update.update_id+1;this.dispatchUpdate(update);}}
    }catch(e){if(this.controller.signal.aborted)break;this.status={state:'error',message:this.clean(e.message)};try{await delay(e.status===429?Math.min(60,Math.max(1,e.retryAfter||1))*1000:30000,undefined,{signal:this.controller.signal})}catch{break;}}}
  }
  stop(){this.controller.abort();this.status={state:'disabled'};}
  clean(text){let result=String(text??'');for(const secret of [this.token,...(this.handlers.secrets?.()||[])])if(secret)result=result.split(secret).join('[СКРЫТО]');return result;}
  async send(text){
    if(this.controller.signal.aborted)return;const cleaned=Array.from(this.clean(text));for(let i=0;i<cleaned.length;i+=3500){await this.deliver('sendMessage',{chat_id:this.userId,text:cleaned.slice(i,i+3500).join(''),disable_web_page_preview:true});}
  }
  enqueue(text,important=false){if(this.controller.signal.aborted)return;if(this.queued>=100&&!important){this.dropped++;return;}const safe=this.clean(text);this.queued++;this.queue=this.queue.then(()=>this.send(safe)).catch(e=>{if(!this.controller.signal.aborted)this.status={state:'error',message:this.clean(e.message)}}).finally(()=>{this.queued--});}
  notify(event){if(event.type==='message')this.enqueue(`DiaboliX:\n${event.text}`);else if(event.type==='error'||event.type==='done'){if(this.dropped){this.enqueue(`Пропущено уведомлений: ${this.dropped}. Полный журнал: /logs.`,true);this.dropped=0;}this.enqueue(event.type==='error'?`Ошибка: ${event.text}`:'Задача завершена.',true);}}
  async sendFile(method,name,bytes,mime){if(bytes.length>40000000)throw Error('Файл слишком большой для отправки через Telegram');const form=new FormData();form.set('chat_id',this.userId);form.set(method==='sendPhoto'?'photo':'document',new Blob([bytes],{type:mime}),name);await this.deliver(method,form);}
  accepts(update){const msg=update.message;return !!msg&&String(msg.from?.id)===this.userId&&String(msg.chat?.id)===this.userId&&msg.chat?.type==='private'&&!msg.from?.is_bot&&!msg.sender_chat&&!msg.via_bot&&!msg.forward_origin&&!msg.forward_from&&!msg.forward_from_chat&&!msg.forward_date&&!msg.is_automatic_forward&&Number.isInteger(msg.date)&&msg.date>=this.startedAt&&typeof msg.text==='string';}
  dispatchUpdate(update){if(!this.accepts(update)||this.controller.signal.aborted)return;if(/^\/(?:stop|models)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())){void this.processUpdate(update);return;}this.incoming=this.incoming.then(()=>this.processUpdate(update)).catch(()=>{});}
  async processUpdate(update){
    const msg=update.message;
    if(this.controller.signal.aborted||!this.accepts(update))return;
    try{await this.handle(msg.text.trim());}catch(e){this.enqueue('Ошибка: '+this.clean(e.message));}
  }
  async handle(text){
    if(!text)return;
    const match=text.match(/^\/(\w+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/),command=match?.[1]?.toLowerCase(),arg=match?.[2]?.trim()||'';
    if(command==='start'||command==='help'){this.enqueue(HELP);return;}
    if(command==='status'){this.enqueue(await this.handlers.status());return;}
    if(command==='logs'){const logs=await this.handlers.logs();await this.sendFile('sendDocument','diabolix-log.txt',Buffer.from(this.clean(logs)),'text/plain');return;}
    if(command==='settings'){this.enqueue(await this.handlers.settings());return;}
    if(command==='stop'){this.enqueue(await this.handlers.stop());return;}
    if(command==='new'){this.session=`telegram:${this.userId}:${crypto.randomUUID()}`;this.enqueue('Новая сессия создана.');return;}
    if(command==='models'){this.enqueue(await this.handlers.models(this.controller.signal));return;}
    if(command==='set'){await this.handlers.set(parseTelegramSetting(arg));this.enqueue('Настройка сохранена.');return;}
    if(command==='rollback'){this.enqueue(await this.handlers.rollback());return;}
    if(command==='changes'){const diff=await this.handlers.changes();await this.sendFile('sendDocument','diabolix-changes.diff',Buffer.from(this.clean(diff||'Изменений нет.\n')),'text/plain');return;}
    if(command==='screen'){const image=await this.handlers.screen();await this.sendFile('sendPhoto','diabolix-screen.png',Buffer.from(image,'base64'),'image/png');return;}
    if(command&&command!=='task'){this.enqueue('Неизвестная команда. Используйте /help.');return;}
    const task=command==='task'?arg:text;if(!task){this.enqueue('Укажите задачу после /task.');return;}
    const result=await this.handlers.run(task,this.session);this.enqueue('Задача запущена: '+result.id);
  }
}
