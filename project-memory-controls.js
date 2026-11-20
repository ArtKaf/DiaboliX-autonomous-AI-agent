// User-controlled exclusions for the journal-derived project memory. Original
// task journals are not modified. Scope keys contain hashes, not local paths.
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_BYTES=256*1024,MAX_SCOPES=100,MAX_REFS=2000,MAX_PER_SCOPE=500;
const validId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
function scopeKey(workspace,profile){
 if(typeof workspace!=='string'||!workspace||workspace.includes('\0')||typeof profile!=='string'||!profile||profile.includes('\0'))throw Error('Invalid project memory scope');
 return crypto.createHash('sha256').update(workspace).update('\0').update(profile).digest('hex');
}
function refKey(runId,eventId){
 if(!validId(runId)||!Number.isSafeInteger(eventId)||eventId<1)throw Error('Invalid project memory source');
 return `${runId.toLowerCase()}:${eventId}`;
}
function parseRef(value){
 if(typeof value!=='string')throw Error('Invalid project memory exclusion');
 const match=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]*)$/.exec(value);
 if(!match)throw Error('Invalid project memory exclusion');const eventId=Number(match[2]);refKey(match[1],eventId);return {run_id:match[1],event_id:eventId};
}

export class ProjectMemoryControls{
 constructor(dir){if(typeof dir!=='string'||!dir)throw Error('Invalid project memory directory');this.dir=dir;this.file=path.join(dir,'project-memory-exclusions.json');this.tail=Promise.resolve()}
 async readAll(){
  if(!constants.O_NOFOLLOW)throw Error('Safe project memory exclusion reading is unavailable');
  let handle;try{handle=await open(this.file,constants.O_RDONLY|constants.O_NOFOLLOW)}catch(e){if(e.code==='ENOENT')return Object.create(null);throw e}
  try{
   const info=await handle.stat();if(!info.isFile()||info.size>MAX_BYTES)throw Error('Project memory exclusions are invalid or too large');
   const buffer=Buffer.alloc(MAX_BYTES+1);let count=0;while(count<buffer.length){const part=await handle.read(buffer,count,buffer.length-count,null);if(!part.bytesRead)break;count+=part.bytesRead}if(count>MAX_BYTES)throw Error('Project memory exclusions are too large');
   let data;try{data=JSON.parse(buffer.subarray(0,count).toString('utf8'))}catch{throw Error('Project memory exclusions are corrupted')}
   if(!data||data.version!==1||!data.scopes||typeof data.scopes!=='object'||Array.isArray(data.scopes))throw Error('Project memory exclusions have an unsupported format');
   const result=Object.create(null),entries=Object.entries(data.scopes);if(entries.length>MAX_SCOPES)throw Error('Too many project memory scopes');let total=0;
   for(const [key,refs] of entries){if(!/^[a-f0-9]{64}$/.test(key)||!Array.isArray(refs)||refs.length>MAX_PER_SCOPE)throw Error('Invalid project memory exclusions');const seen=new Set();for(const ref of refs){const item=parseRef(ref),normalized=refKey(item.run_id,item.event_id);if(seen.has(normalized))throw Error('Duplicate project memory exclusion');seen.add(normalized)}total+=seen.size;if(total>MAX_REFS)throw Error('Too many project memory exclusions');result[key]=[...seen]}
   return result;
  }finally{await handle.close()}
 }
 async saveAll(scopes){
  const data=JSON.stringify({version:1,scopes})+'\n';if(Buffer.byteLength(data)>MAX_BYTES)throw Error('Project memory exclusions are too large');
  await mkdir(this.dir,{recursive:true,mode:0o700});const temporary=path.join(this.dir,`.project-memory-${crypto.randomUUID()}.tmp`);let handle;
  try{handle=await open(temporary,'wx',0o600);await handle.writeFile(data,'utf8');await handle.close();handle=null;await rename(temporary,this.file)}finally{if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e})}
 }
 // A single running DiaboliX server serializes its changes. This is not an
 // interprocess lock; two independent servers must not share this directory.
 mutate(operation){const result=this.tail.then(operation);this.tail=result.catch(()=>{});return result}
 list({workspace,profile}={}){return this.mutate(async()=>{const scopes=await this.readAll();return (scopes[scopeKey(workspace,profile)]||[]).map(parseRef)})}
 forget({workspace,profile,run_id,event_id}={}){return this.mutate(async()=>{
  const scope=scopeKey(workspace,profile),ref=refKey(run_id,event_id),scopes=await this.readAll();const refs=scopes[scope]||[];if(refs.includes(ref))return {forgotten:true,already_excluded:true};
  if(refs.length>=MAX_PER_SCOPE||Object.values(scopes).reduce((n,x)=>n+x.length,0)>=MAX_REFS||!scopes[scope]&&Object.keys(scopes).length>=MAX_SCOPES)throw Error('Project memory exclusion limit reached');
  scopes[scope]=[...refs,ref];await this.saveAll(scopes);return {forgotten:true,already_excluded:false};
 })}
 restore({workspace,profile,run_id,event_id}={}){return this.mutate(async()=>{
  const scope=scopeKey(workspace,profile),ref=refKey(run_id,event_id),scopes=await this.readAll(),refs=scopes[scope]||[];if(!refs.includes(ref))return {restored:false};
  scopes[scope]=refs.filter(x=>x!==ref);if(!scopes[scope].length)delete scopes[scope];await this.saveAll(scopes);return {restored:true};
 })}
}

// Always apply the current exclusions to the cached projection before exposing
// either its view or a projected source. Fail closed when the file is invalid.
export async function filterProjectMemory(archive,controls,{workspace,profile}={}){
 const exclusions=await controls.list({workspace,profile});const blocked=new Set(exclusions.map(x=>refKey(x.run_id,x.event_id)));
 return {...archive,records:(archive?.records||[]).filter(item=>{try{return !blocked.has(refKey(item?.source?.run_id,item?.source?.event_id))}catch{return false}})};
}
