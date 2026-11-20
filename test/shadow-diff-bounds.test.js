import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ShadowGit} from '../shadow.js';

test('bounded shadow diff preserves exact prefix and truncation for large Unicode content',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-shadow-bounded-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'unicode.txt'),'before\n');const shadow=await ShadowGit.create(dir);t.after(()=>shadow.dispose());
 await writeFile(path.join(dir,'unicode.txt'),'κόσμος 漢字 😈\n'.repeat(100000));
 const complete=await shadow.diff({maxLength:Infinity});assert.equal(complete.truncated,false);assert.ok(complete.diff.length>1_000_000);
 for(const maxLength of [0,1,19,500,10000,60000,complete.diff.length,complete.diff.length+1]){
  const short=await shadow.diff({maxLength});assert.equal(short.diff,complete.diff.slice(0,maxLength));assert.equal(short.truncated,complete.diff.length>maxLength);
 }
 await assert.rejects(shadow.diff({maxLength:-1}),/Invalid diff length/);
});
