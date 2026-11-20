import {readFile,readdir,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const exec=promisify(execFile), digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const rootFiles=/^(?:[a-zA-Z0-9_-]+\.(?:js|cjs|mjs)|package(?:-lock)?\.json)$/;
const sourceExtensions=/\.(?:js|cjs|mjs|yml|yaml|sh)$/;
// Best-effort name filtering, not a guarantee that included source is secret-free.
const localNames=/(?:^|[._-])(?:local|credentials?|secrets?|passwords?|tokens?|api[-_]?keys?|keys?|private|dotenv|env|logs?|reports?|results?)(?:[._-]|$)/i;
const excludedName=name=>name.startsWith('.')||localNames.test(name);
const nestedSource=name=>sourceExtensions.test(name)||/^(?:package(?:-lock)?\.json|Dockerfile)$/.test(name);
const folders=['eval','sandbox','computer','mcp'];
const blocked=new Set(['node_modules','.git','.venv','venv','__pycache__','.diabolix-sessions','dist','coverage','build']);
const MAX_FILE_BYTES=10*1024*1024,MAX_TOTAL_BYTES=100*1024*1024,MAX_FILES=2000;
export const FINGERPRINT_SCOPE='Selected harness source; excludes hidden, local, secret-like, credential-like, log and report paths and arbitrary JSON. Exclusions can affect execution and are not tracked.';

export function fixtureHash(item){return digest(JSON.stringify(item))}

// Hash selected harness source only; never serialize raw file contents. Name
// filters reduce sensitive reads but cannot identify every secret or active file.
export async function sourceFingerprint(root){
 try{
  const selected=[];
  for(const entry of await readdir(root,{withFileTypes:true})){if(excludedName(entry.name))continue;if(rootFiles.test(entry.name)&&entry.isSymbolicLink())throw Error('Symlinked root source');if(entry.isFile()&&rootFiles.test(entry.name)){selected.push(entry.name);if(selected.length>MAX_FILES)throw Error('Too many source files')}}
  async function visit(relative){
   const dir=path.join(root,relative);let entries;try{const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Source directory is not a regular directory');entries=await readdir(dir,{withFileTypes:true})}catch(error){if(error.code==='ENOENT')return;throw error}
   for(const entry of entries){if(blocked.has(entry.name)||excludedName(entry.name))continue;if(entry.isSymbolicLink())throw Error('Symlinked source');const rel=path.posix.join(relative,entry.name);if(entry.isDirectory())await visit(rel);else if(entry.isFile()&&nestedSource(entry.name)){selected.push(rel);if(selected.length>MAX_FILES)throw Error('Too many source files')}}
  }
  for(const folder of folders)await visit(folder);
  selected.sort();for(const required of ['server.js','package.json','sandbox/worker.cjs','eval/run.js','eval/cases.js','eval/manifest.js','eval/compare.js'])if(!selected.includes(required))throw Error('Required source unavailable');if(selected.length>MAX_FILES)throw Error('Too many source files');let total=0;const hash=crypto.createHash('sha256');
  for(const rel of selected){const file=path.join(root,rel),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_FILE_BYTES)throw Error('Source file unavailable or oversized');total+=info.size;if(total>MAX_TOTAL_BYTES)throw Error('Source tree exceeds fingerprint limit');const contents=await readFile(file);hash.update(JSON.stringify([rel,contents.length])).update('\0').update(contents).update('\0')}
  return {status:'available',sha256:hash.digest('hex'),files:selected.length};
 }catch{return {status:'unavailable',sha256:null,files:null}}
}

export function endpointFingerprint(endpoint){
 try{const u=new URL(endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)return null;return digest(u.toString())}catch{return null}
}

export async function sandboxImageFingerprint(image=process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'){
 try{const {stdout}=await exec('docker',['image','inspect',image,'--format','{{.Id}}'],{timeout:5000,maxBuffer:65536});const id=stdout.trim();return /^sha256:[a-f0-9]{64}$/.test(id)?{status:'available',id}:{status:'unavailable',id:null}}catch{return {status:'unavailable',id:null}}
}

export async function makeManifest({root,endpoint,model,modelRevision='',timeoutMs,repeats,fixtures,maxSteps=12,image}={}){
 const dockerVersion=async()=>{try{const {stdout}=await exec('docker',['version','--format','{{.Server.Version}}'],{timeout:5000,maxBuffer:4096});return stdout.trim()||null}catch{return null}};
 const [source,sandbox,docker]=await Promise.all([sourceFingerprint(root),sandboxImageFingerprint(image),dockerVersion()]);
 return {version:1,kind:'synthetic-coding-fixtures',fixtures:fixtures.map(item=>({id:item.id,sha256:fixtureHash(item)})).sort((a,b)=>a.id.localeCompare(b.id)),
  conditions:{model,model_revision:modelRevision||null,endpoint_sha256:endpointFingerprint(endpoint),timeout_ms:timeoutMs,repeats,max_steps:maxSteps,profile:'coding',mcp:'disabled',computer:'disabled',network:'sandbox-offline; registry installer may use restricted network',node:process.version,platform:process.platform,architecture:process.arch,kernel:os.release(),host_cpu_model:os.cpus()[0]?.model||null,host_cpu_count:os.cpus().length||null,host_memory_bytes:os.totalmem()||null,sandbox_engine_version:docker,sandbox_image_id:sandbox.id},
  harness:{source_sha256:source.sha256,source_files:source.files,fingerprint_scope:FINGERPRINT_SCOPE},
  notice:'Local self-reported conditions, not a benchmark score or proof of provider model identity. Source fingerprints exclude local and sensitive-looking paths and cannot guarantee all secrets were excluded or all execution-relevant files were captured. Different harness source is expected in an A/B test. Environment, provider revisions and non-determinism can still affect results.'};
}
