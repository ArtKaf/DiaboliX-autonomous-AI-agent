// Rebuildable, local-only project navigation hints. These are not evidence of
// file existence, symbol semantics, or present-day contents; verify with tools.
import { open, readdir, lstat, mkdir, readFile, realpath, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const VERSION=1, MAX_FILES=12000, MAX_ENTRIES=60000, MAX_FILE_BYTES=256*1024, MAX_READ_BYTES=32*1024*1024, MAX_CACHE_BYTES=8*1024*1024;
const EXT=new Set(['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts','.py','.pyi']);
const EXCLUDED=new Set(['.git','node_modules','dist','build','.next','coverage','.venv','venv','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache','.tox','.diabolix-sessions','.diabolix-orders','.diabolix-eval-results']);
const WORD=/[\p{L}\p{N}_$]+/gu;
function sensitiveName(s){return /(?:^|[._-])(?:secrets?|credentials?|private[_-]?keys?|api[_-]?keys?|tokens?)(?:$|[._-])/i.test(s)||/^(?:keys?|private)$/i.test(s)||/^config\.local(?:\.|$)/i.test(s)}
function abortError(signal){if(signal?.aborted){const error=Error('Project indexing cancelled');error.name='AbortError';throw error}}
function safeName(s){return typeof s==='string'&&s.length>0&&s.length<=500&&!s.includes('\0')&&!s.includes('\\')&&!path.posix.isAbsolute(s)&&!s.split('/').some(x=>x==='..'||x==='.'||!x||x.startsWith('.'));}
function terms(s){return [...new Set((String(s||'').replace(/([\p{Ll}\d])([\p{Lu}])/gu,'$1 $2').toLowerCase().match(WORD)||[]).flatMap(x=>x.split(/[_$]+/)).filter(x=>x.length>=3&&x.length<=100))].slice(0,40)}
function signature(st){return [st.dev,st.ino,st.size,st.mtimeMs,st.ctimeMs].join(':')}
function parse(text,rel){
 // Syntactic hints: comments, dynamic imports and aliases can cause errors.
 const names=new Set(),imports=new Set();let m;
 const js=/\b(?:class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
 const py=/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm;
 const rx=/\.pyi?$/i.test(rel)?py:js;
 while(names.size<80&&(m=rx.exec(text)))names.add(m[1]);
 const jsImport=/(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"'\r\n]+)["']/g;
 const pyImport=/^\s*from\s+(\.{1,2}[\w.]*)\s+import\b/gm;
 for(const pattern of [jsImport,...(/\.pyi?$/i.test(rel)?[pyImport]:[])])while(imports.size<30&&(m=pattern.exec(text)))if(m[1].length<=200)imports.add(m[1]);
 return {symbols:[...names],imports:[...imports]};
}
function git(args,{cwd,input,env,signal}={}){return new Promise((resolve,reject)=>{try{abortError(signal)}catch(e){reject(e);return}const child=spawn('git',args,{cwd,env,stdio:['pipe','pipe','pipe']});const stdout=[],stderr=[];let bytes=0,failed=false;const onAbort=()=>child.kill();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort)};const timer=setTimeout(()=>{failed=true;child.kill()},2000);timer.unref();child.on('error',error=>{cleanup();reject(error)});child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024){failed=true;child.kill();return}stdout.push(chunk)});child.stderr.on('data',chunk=>{if(stderr.reduce((n,x)=>n+x.length,0)<4096)stderr.push(chunk)});child.stdin.on('error',()=>{});child.stdin.end(input);child.on('close',code=>{cleanup();if(signal?.aborted){const e=Error('Project indexing cancelled');e.name='AbortError';return reject(e)}if(failed||![0,1].includes(code))reject(Error('git ignore check failed: '+Buffer.concat(stderr).toString().slice(0,200)));else resolve(Buffer.concat(stdout))})})}
async function ignored(root,names,signal){
 if(!names.length)return new Set();const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-index-git-'));
 try{
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull,GIT_DIR:dir,GIT_WORK_TREE:root};
  // A private repository ensures ignore checks never modify the user's .git.
  await git(['init','--bare','-q',dir],{cwd:root,env:{...env,GIT_DIR:undefined,GIT_WORK_TREE:undefined},signal});
  const out=await git(['-c',`core.excludesFile=${os.devNull}`,'check-ignore','--no-index','-z','--stdin'],{cwd:root,env,input:Buffer.from(names.join('\0')+'\0'),signal});
  return new Set(out.toString('utf8').split('\0').filter(Boolean));
 }finally{await rm(dir,{recursive:true,force:true})}
}
function validEntry(e){return e&&typeof e==='object'&&safeName(e.path)&&typeof e.signature==='string'&&e.signature.length<200&&/^[a-f0-9]{64}$/.test(e.hash||'')&&Array.isArray(e.symbols)&&e.symbols.length<=80&&e.symbols.every(s=>typeof s==='string'&&/^[A-Za-z_$][\w$]{0,199}$/.test(s))&&Array.isArray(e.imports)&&e.imports.length<=30&&e.imports.every(s=>typeof s==='string'&&s.length<=200)}
export class ProjectIndex {
 constructor(workspace,storageDir){this.workspace=workspace;this.storageDir=storageDir;this.records=[];this.visible=[];this.partial=true;this.stats={};this.root=null;this.cacheFile=null;this.busy=null;}
 static async create(workspace,storageDir){const root=await realpath(workspace);const index=new ProjectIndex(root,storageDir);index.root=root;index.cacheFile=path.join(storageDir,crypto.createHash('sha256').update(root).digest('hex')+'.json');await index.load();return index;}
 async load(){try{const st=await lstat(this.cacheFile);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_CACHE_BYTES)return;const cache=JSON.parse(await readFile(this.cacheFile,'utf8'));if(cache.version!==VERSION||cache.workspace_hash!==crypto.createHash('sha256').update(this.root).digest('hex')||!Array.isArray(cache.files)||cache.files.length>MAX_FILES||!cache.files.every(validEntry))return;this.records=cache.files;this.partial=true;this.stats={loaded_cache:true};}catch(e){if(e.code!=='ENOENT'&&e.name!=='SyntaxError')this.stats={cache_error:true}}}
 scan({signal}={}){if(this.busy)return this.busy;this.busy=this._scan(signal).finally(()=>{this.busy=null});return this.busy;}
 async _scan(signal){
  const deadline=Date.now()+2500;
  const names=[],dirs=[''];let visited=0,partial=false,skipped=0;const old=new Map(this.records.map(x=>[x.path,x]));
  try{
   for(let i=0;i<dirs.length;i++){
    abortError(signal);if(Date.now()>deadline){partial=true;break}
    let entries;try{entries=await readdir(path.join(this.root,dirs[i]),{withFileTypes:true})}catch{partial=true;continue}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){abortError(signal);if(Date.now()>deadline){partial=true;break}if(++visited>MAX_ENTRIES){partial=true;break}if(EXCLUDED.has(entry.name)||entry.name.startsWith('.')||sensitiveName(entry.name)||entry.isSymbolicLink()){partial=true;continue;}const rel=dirs[i]?dirs[i]+'/'+entry.name:entry.name;if(!safeName(rel))continue;if(entry.isDirectory())dirs.push(rel);else if(entry.isFile()&&EXT.has(path.posix.extname(entry.name).toLowerCase())){names.push(rel);if(names.length>=MAX_FILES){partial=true;break}}else if(entry.isFile()){partial=true;skipped++}}if(partial&&(visited>MAX_ENTRIES||names.length>=MAX_FILES||Date.now()>deadline))break;
   }
   // Fail closed: never persist content-derived metadata if ignore processing fails.
   const excluded=await ignored(this.root,names,signal);const records=[];let readBytes=0,reused=0,parsed=0;
   for(const rel of names){abortError(signal);if(Date.now()>deadline){partial=true;break}if(excluded.has(rel))continue;const file=path.join(this.root,...rel.split('/'));try{
    const parent=await realpath(path.dirname(file));if(parent!==this.root&&!parent.startsWith(this.root+path.sep)){partial=true;continue}const st=await lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_FILE_BYTES){partial=true;skipped++;continue}const sig=signature(st),prev=old.get(rel);if(prev?.signature===sig){records.push(prev);reused++;continue}
    if(readBytes+st.size>MAX_READ_BYTES){partial=true;skipped++;continue}const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let data;try{const before=await fd.stat();if(!before.isFile()||signature(before)!==sig){partial=true;continue}data=await fd.readFile({signal});abortError(signal);const after=await fd.stat();if(signature(after)!==sig){partial=true;continue}}finally{await fd.close()}readBytes+=data.length;if(data.includes(0)){partial=true;skipped++;continue}let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(data)}catch{partial=true;skipped++;continue}records.push({path:rel,signature:sig,hash:crypto.createHash('sha256').update(data).digest('hex'),...parse(text,rel)});parsed++;
   }catch(error){if(signal?.aborted)abortError(signal);partial=true;skipped++}}
   abortError(signal);this.records=records;this.visible=records;this.partial=partial;this.stats={scanned_entries:visited,indexed:records.length,parsed,reused,skipped,partial};try{await this.save(signal)}catch(error){if(signal?.aborted)abortError(signal);this.stats.cache_error=true}return this.stats;
  }catch(error){this.records=[];this.visible=[];this.partial=true;this.stats=error.name==='AbortError'?{aborted:true,partial:true}:{unavailable:true,error:String(error.message||error).slice(0,200),partial:true};return this.stats}
 }
 async save(signal){abortError(signal);await mkdir(this.storageDir,{recursive:true,mode:0o700});abortError(signal);const data=JSON.stringify({version:VERSION,workspace_hash:crypto.createHash('sha256').update(this.root).digest('hex'),files:this.records});if(Buffer.byteLength(data)>MAX_CACHE_BYTES){this.partial=true;return}const tmp=this.cacheFile+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';try{await writeFile(tmp,data,{mode:0o600,flag:'wx',signal});abortError(signal);await rename(tmp,this.cacheFile)}finally{await rm(tmp,{force:true})}}
 search(query,{limit=20,changed=[]}={}){
  const words=terms(query),count=Math.min(50,Math.max(1,Number.isInteger(limit)?limit:20));const all=new Map(this.visible.map(r=>[r.path,r])),scores=new Map(),seeds=new Set(Array.isArray(changed)?changed.filter(x=>typeof x==='string'&&all.has(x)).slice(0,100):[]);
  for(const record of this.visible){const p=record.path.toLowerCase(),symbols=record.symbols.join(' ').toLowerCase();let score=0;for(const word of words){if(p.includes(word))score+=3;if(symbols.includes(word))score+=6}if(score){scores.set(record.path,score);seeds.add(record.path)}}
  for(const record of this.visible)for(const spec of record.imports){if(!spec.startsWith('./')&&!spec.startsWith('../'))continue;const raw=path.posix.normalize(path.posix.join(path.posix.dirname(record.path),spec));if(!safeName(raw))continue;const candidates=[raw,...['.js','.jsx','.ts','.tsx','.mjs','.cjs','.py'].map(ext=>raw+ext),...['.js','.jsx','.ts','.tsx'].map(ext=>raw+'/index'+ext)];const target=candidates.find(p=>all.has(p));if(!target||target===record.path)continue;if(seeds.has(record.path))scores.set(target,(scores.get(target)||0)+2);if(seeds.has(target))scores.set(record.path,(scores.get(record.path)||0)+2)}
  const ranked=[...scores].map(([p,score])=>({path:p,score,hash:all.get(p).hash})).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));return {files:ranked.slice(0,count),partial:this.partial||ranked.length>count,notice:'Local syntactic navigation hints only; index may be stale or incomplete. Imports are approximate; confirm files and semantics with current tools.'};
 }
}
