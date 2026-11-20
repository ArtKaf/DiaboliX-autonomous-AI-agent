// A conservative, explicitly partial snapshot of selected dependency/build
// manifests and an externally verified immutable sandbox image ID. This is not
// a complete environment fingerprint or a boundary against hostile races.
import {open, lstat, realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export const ENVIRONMENT_FILES=Object.freeze([
 'package.json','package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock',
 'bun.lock','bun.lockb','tsconfig.json','jsconfig.json','pyproject.toml','requirements.txt',
 'Pipfile','Pipfile.lock','poetry.lock','uv.lock','Cargo.toml','Cargo.lock','go.mod','go.sum',
 'Gemfile','Gemfile.lock','composer.json','composer.lock','Dockerfile','.nvmrc','.python-version'
]);
export const ENVIRONMENT_LIMITATIONS=Object.freeze([
 'Partial: only the listed files in explicitly selected project directories and the supplied image ID are covered.',
 'Installed dependencies, node_modules, .venv, PATH, environment variables, credentials, running processes, browser state, databases, external services and network data may change unnoticed.',
 'The caller must obtain the immutable ID of the actual sandbox image used; a mutable image tag is not an ID.',
 'Only selected JSON and JSONC files receive syntax validation; other formats are hashed without parsing and may already be invalid.',
 'This is a point-in-time check, not an atomic snapshot or a boundary against hostile concurrent filesystem changes.'
]);
const MAX_ROOTS=8,MAX_FILE_BYTES=1024*1024;
const imagePattern=/^sha256:[a-f0-9]{64}$/;
const strictJson=new Set(['package.json','package-lock.json','npm-shrinkwrap.json','composer.json','composer.lock']);
const jsonc=new Set(['tsconfig.json','jsconfig.json']);
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unknown=reason=>({state:'unknown',reason});

function normalizeRoots(input){
 if(!Array.isArray(input)||!input.length||input.length>MAX_ROOTS)throw Error('Select 1 to 8 project directories.');
 const roots=[];
 for(const item of input){
  if(typeof item!=='string'||item.length>500||item.includes('\0')||item.includes('\\')||path.posix.isAbsolute(item))throw Error('Project directories must be relative paths.');
  const parts=item.split('/');if(parts.some(x=>x==='..'||x===''))throw Error('Project directories must not traverse or contain empty components.');
  const clean=path.posix.normalize(item);if(clean==='..'||clean.startsWith('../'))throw Error('Project directory is outside workspace.');
  if(clean!=='.'&&clean.split('/').some(x=>x.startsWith('.')||['node_modules','dist','build','coverage','venv'].includes(x)))throw Error('Excluded project directory.');
  if(!roots.includes(clean))roots.push(clean);
 }
 return roots.sort();
}
async function directoryAt(root,relative){
 if(relative==='.')return root;
 let current=root;
 for(const part of relative.split('/')){
  current=path.join(current,part);
  try{const info=await lstat(current);if(info.isSymbolicLink()||!info.isDirectory())return null;}catch{return null}
 }
 return current;
}
// Strip JSONC comments and trailing commas without altering string literals.
function validConfigJson(data,allowComments){
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(data);let clean='',quoted=false,escaped=false;
  for(let i=0;i<text.length;i++){
   const ch=text[i];if(quoted){clean+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
   if(ch==='"'){quoted=true;clean+=ch;continue;}
   if(allowComments&&ch==='/'&&text[i+1]==='/'){i+=2;while(i<text.length&&text[i]!=='\n'&&text[i]!=='\r')i++;clean+='\n';continue;}
   if(allowComments&&ch==='/'&&text[i+1]==='*'){const end=text.indexOf('*/',i+2);if(end<0)return false;clean+=' ';i=end+1;continue;}
   clean+=ch;
  }
  if(quoted)return false;
  if(allowComments){let out='',inside=false,escape=false;for(let i=0;i<clean.length;i++){
    const ch=clean[i];if(inside){out+=ch;if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')inside=false;continue;}
    if(ch==='"'){inside=true;out+=ch;continue;}
    if(ch===','){let next=i+1;while(next<clean.length&&/\s/.test(clean[next]))next++;if(clean[next]===']'||clean[next]==='}')continue;}
    out+=ch;
   }clean=out;
  }
  const value=JSON.parse(clean);return !!value&&typeof value==='object'&&!Array.isArray(value);
 }catch{return false;}
}
async function fingerprintFile(file){
 let prior;
 try{prior=await lstat(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return {state:'missing'};return unknown('unreadable')}
 if(prior.isSymbolicLink())return unknown('symlink');
 if(!prior.isFile())return unknown('not_regular_file');
 if(prior.size>BigInt(MAX_FILE_BYTES))return unknown('too_large');
 let handle;
 try{
  handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  const before=await handle.stat({bigint:true});
  if(!before.isFile()||before.size>BigInt(MAX_FILE_BYTES)||before.dev!==prior.dev||before.ino!==prior.ino)return unknown('changed_during_open');
  const hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(65536),name=path.basename(file),isJson=strictJson.has(name)||jsonc.has(name),chunks=[];let total=0;
  while(true){const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>MAX_FILE_BYTES)return unknown('too_large');hash.update(buffer.subarray(0,bytesRead));if(isJson)chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));}
  const after=await handle.stat({bigint:true}),current=await lstat(file,{bigint:true});
  const stable=x=>x.dev===before.dev&&x.ino===before.ino&&x.size===before.size&&x.mtimeNs===before.mtimeNs&&x.ctimeNs===before.ctimeNs&&x.isFile();
  if(!stable(after)||!stable(current))return unknown('changed_during_read');
  if(isJson&&!validConfigJson(Buffer.concat(chunks),jsonc.has(name)))return unknown('invalid_json');
  return {state:'file',sha256:hash.digest('hex'),bytes:total};
 }catch{return unknown('unreadable_or_changed')}
 finally{await handle?.close().catch(()=>{});}
}

/** Capture only named manifest files. `imageId` must be the actual immutable image ID, not a tag. */
export async function captureEnvironment(workspace,{imageId,roots=['.']}={}){
 let directories,root,workspaceId;
 try{directories=normalizeRoots(roots);root=await realpath(workspace);const info=await lstat(root,{bigint:true});if(!info.isDirectory())throw Error('Workspace is not a directory.');workspaceId=crypto.createHash('sha256').update('diabolix-environment-v1\0').update(root).update('\0').update(String(info.dev)).update(':').update(String(info.ino)).digest('hex');}
 catch{return {version:1,scope:'partial',complete:false,reason:'invalid_or_unavailable_workspace',roots:[],image:{state:'unknown'},files:[],limitations:ENVIRONMENT_LIMITATIONS};}
 const image=typeof imageId==='string'&&imagePattern.test(imageId)?{state:'observed',id:imageId}:{state:'unknown'};
 const files=[];
 for(const rel of directories){
  const dir=await directoryAt(root,rel);
  for(const name of ENVIRONMENT_FILES){
   const relative=rel==='.'?name:rel+'/'+name;
   const result=dir?await fingerprintFile(path.join(dir,name)):unknown('directory_unavailable_or_symlink');
   files.push({path:relative,...result});
  }
 }
 const complete=image.state==='observed'&&files.every(f=>f.state!=='unknown');
 return {version:1,scope:'partial',complete,workspace_id:workspaceId,roots:directories,image,files,limitations:ENVIRONMENT_LIMITATIONS};
}

function valid(snapshot){
 if(!snapshot||snapshot.version!==1||snapshot.scope!=='partial'||snapshot.complete!==true||!validHash(snapshot.workspace_id)||snapshot.image?.state!=='observed'||!imagePattern.test(snapshot.image.id||''))return false;
 let roots;try{roots=normalizeRoots(snapshot.roots)}catch{return false}
 if(JSON.stringify(roots)!==JSON.stringify(snapshot.roots)||!Array.isArray(snapshot.files)||snapshot.files.length!==roots.length*ENVIRONMENT_FILES.length)return false;
 const expected=roots.flatMap(root=>ENVIRONMENT_FILES.map(file=>root==='.'?file:root+'/'+file));
 return snapshot.files.every((f,i)=>f?.path===expected[i]&&(f.state==='missing'||f.state==='file'&&validHash(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=MAX_FILE_BYTES));
}
/** Compare only complete observations of this partial scope. Unknown is never equal. */
export function compareEnvironment(before,after){
 const base={scope:'partial',limitations:ENVIRONMENT_LIMITATIONS};
 if(!valid(before)||!valid(after)||before.workspace_id!==after.workspace_id||JSON.stringify(before.roots)!==JSON.stringify(after.roots))return {...base,status:'unknown'};
 const changed=before.image.id===after.image.id?[]:['sandbox_image'];
 for(let i=0;i<before.files.length;i++){
  const a=before.files[i],b=after.files[i];
  if(a.state!==b.state||a.state==='file'&&(a.sha256!==b.sha256||a.bytes!==b.bytes))changed.push(a.path);
 }
 return {...base,status:changed.length?'changed':'unchanged',changed};
}
