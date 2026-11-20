import {mkdir,appendFile,readFile,readdir,stat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {assessRecovery} from './recovery.js';
const valid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export class TaskJournal {
 constructor(dir){this.dir=dir;this.tail=Promise.resolve();this.error=null}
 async init(){await mkdir(this.dir,{recursive:true,mode:0o700})}
 file(id){if(!valid(id))throw Error('Некорректный ID задачи');return path.join(this.dir,id+'.jsonl')}
 append(id,record){const file=this.file(id),line=JSON.stringify(record)+'\n';this.tail=this.tail.then(()=>appendFile(file,line,{mode:0o600})).catch(e=>{this.error=e});return this.tail}
 async flush(){await this.tail;if(this.error){const error=this.error;this.error=null;throw Error('Не удалось сохранить журнал задач: '+error.message)}}
 async read(id,{maxBytes}={}){
  await this.flush();let text;try{
   if(maxBytes===undefined)text=await readFile(this.file(id),'utf8');
   else{
    if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8*1024*1024)throw Error('Некорректный лимит журнала');
    // Do not follow a symlink swapped in after discovery, and read at most one
    // byte beyond the cap even if the file grows while it is being read.
    if(!constants.O_NOFOLLOW)throw Error('Защищённое чтение журнала недоступно');
    const handle=await open(this.file(id),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const info=await handle.stat();if(!info.isFile()||info.size>maxBytes)return null;const buffer=Buffer.alloc(maxBytes+1);let count=0;while(count<buffer.length){const part=await handle.read(buffer,count,buffer.length-count,null);if(!part.bytesRead)break;count+=part.bytesRead}if(count>maxBytes)return null;text=buffer.subarray(0,count).toString('utf8')}finally{await handle.close()}
   }
  }catch(e){if(e.code==='ENOENT'||maxBytes!==undefined&&e.code==='ELOOP')return null;throw e}
  let meta=null,integrity='complete',lastId=0;const events=[];
  const mark=reason=>{if(integrity==='complete')integrity=reason};
  for(const line of text.split('\n')){
   if(!line)continue;let record;try{record=JSON.parse(line)}catch{mark('truncated');break}
   if(!record||typeof record!=='object'||Array.isArray(record)){mark('invalid_record');break}
   if(record.kind==='start'){if(meta){mark('invalid_record');break}meta=record;continue}
   if(record.kind!=='event'){mark('unsupported_record');break}
   if(!meta)mark('missing_metadata');
   const event=record.event;if(!event||typeof event!=='object'||Array.isArray(event)||typeof event.type!=='string'||!event.type||!Number.isSafeInteger(event.id)||event.id!==lastId+1){mark('invalid_record');break}
   lastId=event.id;events.push(event);
  }
  // append() always terminates records with a newline. A syntactically valid
  // trailing fragment without it can still be a torn final write.
  if(text&&!text.endsWith('\n'))mark('truncated');
  if(!meta||typeof meta.task!=='string'||typeof meta.workspace!=='string'||typeof meta.profile!=='string')mark('missing_metadata');
  if(meta?.journal_version!==undefined&&meta.journal_version!==1)mark('unsupported_version');
  const finished=events.some(e=>e.type==='finished'),error=events.findLast(e=>e.type==='error');
  const status=integrity!=='complete'?'incompatible':!finished?'interrupted':error?(/Остановлено пользователем/.test(error.text||'')?'cancelled':'error'):events.some(e=>e.type==='done')?'completed':'unknown';
  const review=events.findLast(e=>e.type==='review_assessment'||e.type==='verification_summary');
  const verification_status=integrity!=='complete'?'unconfirmed':!review?'unknown':review.type==='verification_summary'?'unconfirmed':Array.isArray(review.assessments)&&review.assessments.length>0&&!(review.requirements_omitted>0)&&review.assessments.every(x=>x?.status==='supported_by_reviewer')?'requires_revalidation':'unconfirmed';
  const result={id,verification_status,journal_integrity:integrity,journal_version:meta?.journal_version??null,task:typeof meta?.task==='string'?meta.task:'[Текст задачи недоступен]',workspace:typeof meta?.workspace==='string'?meta.workspace:'',profile:typeof meta?.profile==='string'?meta.profile:'',started_at:typeof meta?.started_at==='string'?meta.started_at:'',...(valid(meta?.parent_id)?{parent_id:meta.parent_id}:{}),...(typeof meta?.original_task==='string'?{original_task:meta.original_task}:{}),events,done:finished,status};
  return {...result,recovery:assessRecovery(result)};
 }
 async ancestry(id,{workspace,profile,limit=8}={}){const chain=[],seen=new Set();let cursor=id;while(cursor&&chain.length<limit){if(!valid(cursor)||seen.has(cursor))break;seen.add(cursor);const item=await this.read(cursor);if(!item||item.journal_integrity!=='complete'||workspace!==undefined&&item.workspace!==workspace||profile!==undefined&&item.profile!==profile)break;chain.unshift({run_id:item.id,task:item.task,events:item.events});cursor=item.parent_id}return chain}
 async list(){await this.flush();let names;try{names=await readdir(this.dir)}catch(e){if(e.code==='ENOENT')return [];throw e}const entries=[];for(const name of names.filter(x=>/^[0-9a-f-]{36}\.jsonl$/i.test(x))){const id=name.slice(0,-6);if(!valid(id))continue;try{const info=await stat(path.join(this.dir,name));entries.push({id,mtime:info.mtimeMs})}catch{}}entries.sort((a,b)=>b.mtime-a.mtime);const result=[];for(const {id} of entries.slice(0,100)){const item=await this.read(id);if(item)result.push({id,task:item.task,workspace:item.workspace,profile:item.profile,started_at:item.started_at,status:item.status,verification_status:item.verification_status,journal_integrity:item.journal_integrity,journal_version:item.journal_version,recovery:item.recovery})}return result}
}
export function safeJournalEvent(event,secrets=[]){
 function clean(value){if(typeof value==='string'){let text=value;for(const secret of secrets)if(typeof secret==='string'&&secret.length>=4)text=text.replaceAll(secret,'[redacted]');return text.slice(0,50000)}if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object'){const result={};for(const [key,item] of Object.entries(value)){if(key==='image'||/^(?:apiKey|telegramToken|authorization)$/i.test(key))continue;result[key]=clean(item)}return result}return value}
 return clean(event);
}
