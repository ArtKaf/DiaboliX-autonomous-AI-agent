import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';

const exec=promisify(execFile);
// A bounded, read-only view of the user's own Git index. Shadow Git remains the
// authoritative source for task changes; this never invokes Git hooks or writes.
export async function gitContext(workspace){
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
 for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_CONFIG','GIT_CONFIG_COUNT'])delete env[key];
 const args=['--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null'];
 const options={cwd:workspace,env,timeout:2000,maxBuffer:128*1024,encoding:'utf8'};
 try{
  const root=(await exec('git',[...args,'rev-parse','--show-toplevel'],options)).stdout.trim();
  if(await realpath(root)!==await realpath(workspace))return {available:false,reason:'workspace is not the Git root'};
  const status=(await exec('git',[...args,'status','--porcelain=v1','-b','--untracked-files=no'],options)).stdout.split('\n');
  const branch=(status.shift()||'').slice(3,303);const changes=status.filter(Boolean);return {available:true,branch,tracked_changes:changes.slice(0,40).map(line=>line.slice(0,350)),truncated:changes.length>40,notice:'Read-only snapshot of the user Git index and tracked files. Untracked files are omitted; use project_state and Shadow Git for task changes.'};
 }catch{return {available:false,reason:'no accessible Git repository or status timed out'}}
}
