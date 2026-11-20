import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ShadowGit} from '../shadow.js';
import {previewRollback} from '../rollback-preview.js';

test('rollback preview lists scoped actions without changing tracked or excluded files',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-rollback-preview-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'existing.txt'),'initial');await writeFile(path.join(dir,'.env'),'private');await writeFile(path.join(dir,'binary.bin'),Buffer.from([0,1,2]));
 const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());
 assert.equal((await previewRollback(shadow)).status,'task_not_sealed');
 await writeFile(path.join(dir,'existing.txt'),'agent change');await writeFile(path.join(dir,'created.txt'),'new file');await writeFile(path.join(dir,'.env'),'new private');await writeFile(path.join(dir,'binary.bin'),Buffer.from([0,9,9]));
 await shadow.seal();const result=await previewRollback(shadow);
 assert.equal(result.status,'requires_final_revalidation');assert.deepEqual(result.changes.map(x=>[x.path,x.operation]),[['created.txt','remove_created_file'],['existing.txt','restore_baseline_file']]);
 assert.match(result.scope_notice,/Бинарные файлы/);assert.match(result.scope_notice,/\.env/);assert.match(result.notice,/время задачи/);assert.match(result.notice,/частичный откат/);
 assert.equal(await readFile(path.join(dir,'existing.txt'),'utf8'),'agent change');assert.equal(await readFile(path.join(dir,'created.txt'),'utf8'),'new file');assert.equal(await readFile(path.join(dir,'.env'),'utf8'),'new private');assert.deepEqual(await readFile(path.join(dir,'binary.bin')),Buffer.from([0,9,9]));
 const short=await previewRollback(shadow,{limit:1});assert.equal(short.status,'preview_incomplete');assert.equal(short.total,2);assert.equal(short.changes.length,1);assert.equal(short.truncated,true);
});
test('rollback preview detects tracked changes after sealing and does not claim to detect excluded-file changes',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-rollback-conflict-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'a.txt'),'baseline');await writeFile(path.join(dir,'.env'),'baseline');const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());await writeFile(path.join(dir,'a.txt'),'task');await shadow.seal();await writeFile(path.join(dir,'.env'),'external');const untracked=await previewRollback(shadow);assert.equal(untracked.status,'requires_final_revalidation');assert.match(untracked.scope_notice,/\.env/);await writeFile(path.join(dir,'a.txt'),'external');const conflict=await previewRollback(shadow);assert.equal(conflict.status,'changed_after_task');assert.deepEqual(conflict.intervening_changes.paths.map(x=>x.path),['a.txt']);assert.equal(await readFile(path.join(dir,'a.txt'),'utf8'),'external');await assert.rejects(shadow.rollback(),/изменения/);
});
test('rollback preview reports a symlink conflict even if the excluded link itself was present when sealed',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-rollback-link-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(path.join(dir,'a.txt'),'baseline');const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());await rm(path.join(dir,'a.txt'));await symlink('missing',path.join(dir,'a.txt'));await shadow.seal();const result=await previewRollback(shadow);assert.equal(result.status,'path_conflict');assert.equal(result.changes[0].path,'a.txt');assert.match(result.changes[0].path_conflict,/символическ/);await assert.rejects(shadow.rollback(),/символическая ссылка/i);
});
