import {lstat} from 'node:fs/promises';
import path from 'node:path';

const MAX_CAPTURE=1024*1024,MAX_PATH_BYTES=48000;
const scopeNotice='Откат охватывает только текстовые файлы, включённые в Shadow Git. Бинарные файлы, символические ссылки, .env, защищённые настройки, зависимости и исключённые каталоги не учитываются. Метаданные файлов и внешние действия не восстанавливаются.';
const raceNotice='Предпросмотр не блокирует внешние изменения. Перед откатом состояние будет проверено повторно; изменения пользователя, сделанные во время задачи, нельзя надёжно отличить от изменений агента. Файлы восстанавливаются последовательно: при ошибке возможен частичный откат.';

async function nameStatus(shadow,from,to){
 const data=await shadow.git(['diff','--no-ext-diff','--no-textconv','--no-renames','--name-status','-z',from,to,'--'],undefined,{maxCaptureBytes:MAX_CAPTURE});
 // A capture limit can cut through UTF-8. Decode only complete NUL-separated
 // tokens in that case, and report that additional entries were omitted.
 const complete=data.captureOverflow?data.subarray(0,data.lastIndexOf(0)+1):data;
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(complete)}catch{throw Error('Невозможно безопасно отобразить имена файлов в предпросмотре отката.');}
 const parts=text.split('\0');if(parts.at(-1)==='')parts.pop();else parts.pop();
 // If capture was truncated, drop an incomplete status/path pair.
 if(parts.length%2){if(!data.captureOverflow)throw Error('Некорректный список изменений для отката.');parts.pop();}
 const files=[];for(let i=0;i+1<parts.length;i+=2){const status=parts[i],name=parts[i+1];if(!['A','M','D','T'].includes(status)||!name||name.includes('\0'))throw Error('Неподдерживаемый статус файла в предпросмотре отката.');files.push({path:name,status});}
 return {files,truncated:!!data.captureOverflow};
}

async function unsafePath(workspace,name){
 const dest=path.resolve(workspace,name),relative=path.relative(workspace,dest);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return 'Путь выходит за пределы рабочей папки.';
 const parts=relative.split(path.sep);let cursor=workspace;
 for(const [index,part] of parts.entries()){
  cursor=path.join(cursor,part);let info;
  try{info=await lstat(cursor)}catch(error){if(error.code==='ENOENT')return null;return 'Не удалось проверить путь: '+error.code;}
  if(info.isSymbolicLink())return 'Путь содержит символическую ссылку.';
  if(index<parts.length-1&&!info.isDirectory())return 'Родительский путь не является каталогом.';
  if(index===parts.length-1&&!info.isFile())return 'Путь не является обычным файлом.';
 }
 return null;
}
function bounded(items,limit){let bytes=0;const visible=[];for(const item of items){const size=Buffer.byteLength(JSON.stringify(item));if(visible.length>=limit||bytes+size>MAX_PATH_BYTES)break;visible.push(item);bytes+=size;}return {items:visible,has_more:visible.length<items.length};}

// This preview never writes workspace files and never authorizes rollback. The
// shadow index is refreshed under its own lock, just as ShadowGit.rollback does.
export async function previewRollback(shadow,{limit=100}={}){
 if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Некорректный лимит предпросмотра отката.');
 if(!shadow||typeof shadow.exclusive!=='function'||typeof shadow._tree!=='function'||typeof shadow.git!=='function')throw Error('Контрольная точка отката недоступна.');
 return shadow.exclusive(async()=>{
  if(!shadow.sealed||!shadow.sealedTree)return {status:'task_not_sealed',changes:[],scope_notice:scopeNotice,notice:raceNotice};
  const current=await shadow._tree(),changes=await nameStatus(shadow,shadow.baseline,shadow.sealedTree);
  const boundedChanges=bounded(changes.files,limit),items=[];
  for(const entry of boundedChanges.items){const issue=await unsafePath(shadow.workspace,entry.path);items.push({...entry,operation:entry.status==='A'?'remove_created_file':'restore_baseline_file',...(issue?{path_conflict:issue}:{})});}
  let intervening=null;if(current!==shadow.sealedTree){const delta=await nameStatus(shadow,shadow.sealedTree,current),visible=bounded(delta.files,limit);intervening={paths:visible.items,total:delta.truncated?null:delta.files.length,truncated:delta.truncated||visible.has_more};}
  const truncated=changes.truncated||boundedChanges.has_more;
  return {status:intervening?'changed_after_task':items.some(x=>x.path_conflict)?'path_conflict':truncated?'preview_incomplete':'requires_final_revalidation',changes:items,total:changes.truncated?null:changes.files.length,truncated,...(intervening?{intervening_changes:intervening}:{}),scope_notice:scopeNotice,notice:raceNotice};
 });
}
