import path from 'node:path';
import os from 'node:os';
import {mkdtemp,rm,readdir,chmod,lstat} from 'node:fs/promises';
import {ShadowGit} from './shadow.js';

const forbidden=new Set(['.git','.diabolix-sessions','node_modules','.venv','venv','dist','build','coverage','.next']);
function scopePath(value){
 if(typeof value!=='string'||!value||value.length>400||value.includes('\0')||value.startsWith('/')||value.includes('\\'))throw Error('Use a relative project scope.');
 const parts=value.split('/');if(parts.some(x=>!x||x==='.'||x==='..'||forbidden.has(x)||x==='.env'||x.startsWith('.env.')||x==='config.local.json'))throw Error('Invalid or protected delegation scope.');
 return parts.join('/');
}
const overlaps=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
async function makeWritable(directory){await chmod(directory,0o777);for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==='.git'||entry.isSymbolicLink())continue;const file=path.join(directory,entry.name);if(entry.isDirectory())await makeWritable(file);else if(entry.isFile()){const st=await lstat(file);await chmod(file,st.mode|0o222)}}}
export function validateDelegation(tasks){
 if(!Array.isArray(tasks)||tasks.length<2||tasks.length>3)throw Error('Delegate two or three independent tasks.');
 const scopes=[];return tasks.map(task=>{if(typeof task?.task!=='string'||!task.task.trim()||task.task.length>2000||!Array.isArray(task.paths)||!task.paths.length||task.paths.length>8)throw Error('Each task needs a description and 1–8 non-overlapping paths.');const paths=task.paths.map(scopePath);for(const p of paths){if(scopes.some(x=>overlaps(x,p)))throw Error('Delegated scopes overlap; split the work or use one agent.');scopes.push(p)}return {task:task.task.trim(),paths}});
}

// Uses the service-owned Shadow Git repository, never the user's Git metadata.
// Child patches are returned for inspection; they are never applied to the parent.
export async function delegateTasks({shadow,tasks,execute,signal,onProgress=()=>{}}){
 tasks=validateDelegation(tasks);if(signal?.aborted)throw signal.reason||Error('Stopped');
 const root=await mkdtemp(path.join(os.tmpdir(),'diabolix-delegate-'));let base;
 try{
  base=await shadow.checkpoint('Delegation baseline');const baseTree=(await shadow.git(['rev-parse',`${base}^{tree}`])).toString().trim();
  const results=await Promise.allSettled(tasks.map(async(item,index)=>{
   const directory=path.join(root,'worker-'+index);let added=false,child;
   try{
    if(signal?.aborted)throw signal.reason||Error('Stopped');await shadow.addWorktree(directory,base);added=true;await makeWritable(directory);child=await ShadowGit.create(directory);
    onProgress({index,status:'started'});const summary=await execute({directory,task:item.task,paths:item.paths,index,signal});
    if(signal?.aborted)throw signal.reason||Error('Stopped');const state=await child.state({limit:501,changedOnly:true});
    if(state.has_more||state.total>500)throw Error('Delegated change exceeds 500 tracked files; no patch was returned.');
    const outside=state.files.filter(x=>!item.paths.some(p=>x.path===p||x.path.startsWith(p+'/')));
    if(outside.length)throw Error('Delegated changes outside assigned paths were discarded: '+outside.slice(0,10).map(x=>x.path).join(', '));
    const diff=await child.diff({maxLength:120000});onProgress({index,status:'finished'});
    return {index,task:item.task,paths:item.paths,summary:String(summary||'').slice(0,3000),files:state.files,diff:diff.diff,diff_truncated:diff.truncated,base_tree:baseTree,notice:'Untrusted proposal from an isolated worktree. Not applied; inspect and integrate against current files. Dependency directories and excluded/binary files are not included.'};
   }finally{if(child)await child.dispose().catch(()=>{});if(added)await shadow.removeWorktree(directory).catch(()=>{});await rm(directory,{recursive:true,force:true}).catch(()=>{})}
  }));
  if(signal?.aborted)throw signal.reason||Error('Stopped');
  return results.map((r,index)=>r.status==='fulfilled'?r.value:{index,task:tasks[index].task,paths:tasks[index].paths,error:String(r.reason?.message||r.reason).slice(0,1000),base_tree:baseTree});
 }finally{await rm(root,{recursive:true,force:true}).catch(()=>{});await shadow.git(['worktree','prune']).catch(()=>{})}
}
