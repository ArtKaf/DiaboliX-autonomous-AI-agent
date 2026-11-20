import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {gitContext} from '../git-context.js';

test('Git context reports current tracked changes without including untracked files or parent repositories',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-git-context-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');await writeFile(path.join(dir,'tracked.js'),'original\n');git('add','tracked.js');git('commit','-qm','baseline');await writeFile(path.join(dir,'tracked.js'),'changed\n');await writeFile(path.join(dir,'untracked.js'),'private\n');
 const state=await gitContext(dir);assert.equal(state.available,true);assert.ok(state.tracked_changes.some(line=>line.includes('tracked.js')));assert.ok(!state.tracked_changes.some(line=>line.includes('untracked.js')));
 await mkdir(path.join(dir,'subdir'));assert.equal((await gitContext(path.join(dir,'subdir'))).available,false);
});
