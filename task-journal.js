import {mkdir,appendFile,readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const valid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export class TaskJournal {
 constructor(dir){this.dir=dir;this.tail=Promise.resolve();this.error=null}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700})}
 file(id){if(!valid(id))throw Error('Некорректный ID задачи');return path.join(this.dir,id+'.jsonl')}
 append(id,record){const file=this.file(id),line=JSON.stringify(record)+'\n';this.tail=this.tail.then(()=>appendFile(file,line,{mode:0o600})).catch(e=>{this.error=e});return this.tail}
 async flush(){await this.tail;if(this.error){const error=this.error;this.error=null;throw Error('Не удалось сохранить журнал задач: '+error.message)}}
 async read(id){await this.flush();let text;try{text=await readFile(this.file(id),'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}const records=[];for(const line of text.split('\n')){if(!line)continue;try{records.push(JSON.parse(line))}catch{break}}const meta=records.find(x=>x.kind==='start');if(!meta)return null;const events=records.filter(x=>x.kind==='event').map(x=>x.event),finished=events.some(e=>e.type==='finished'),error=events.findLast(e=>e.type==='error');const status=!finished?'interrupted':error?(/Остановлено пользователем/.test(error.text||'')?'cancelled':'error'):events.some(e=>e.type==='done')?'completed':'unknown';return {id,task:meta.task,workspace:meta.workspace,profile:meta.profile,started_at:meta.started_at,events,done:finished,status};}
 async list(){await this.flush();let names;try{names=await readdir(this.dir)}catch(e){if(e.code==='ENOENT')return [];throw e}const entries=[];for(const name of names.filter(x=>/^[0-9a-f-]{36}\.jsonl$/i.test(x))){const id=name.slice(0,-6);try{const info=await stat(path.join(this.dir,name));entries.push({id,mtime:info.mtimeMs})}catch{}}entries.sort((a,b)=>b.mtime-a.mtime);const result=[];for(const {id} of entries.slice(0,100)){const item=await this.read(id);if(item)result.push({id,task:item.task,workspace:item.workspace,profile:item.profile,started_at:item.started_at,status:item.status})}return result}
}
export function safeJournalEvent(event,secrets=[]){
 function clean(value){if(typeof value==='string'){let text=value;for(const secret of secrets)if(typeof secret==='string'&&secret.length>=4)text=text.replaceAll(secret,'[redacted]');return text.slice(0,50000)}if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object'){const result={};for(const [key,item] of Object.entries(value)){if(key==='image'||/^(?:apiKey|telegramToken|authorization)$/i.test(key))continue;result[key]=clean(item)}return result}return value}
 return clean(event);
}
