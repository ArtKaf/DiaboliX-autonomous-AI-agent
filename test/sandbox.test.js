import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {sandboxTool} from '../sandbox.js';
test('AST parsing and guarded rollback run inside Docker',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-sandbox-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'a.js'),'function hello() { return 1; }\n');await chmod(path.join(dir,'a.js'),0o666);
 const signal=new AbortController().signal; const call=(name,args)=>sandboxTool(name,args,dir,signal,1400000);
 let ast=await call('parse_ast',{path:'a.js'});assert.match(ast,/function_declaration/);assert.match(ast,/\[код: 0\]/);
 const before=await call('checkpoint_file',{path:'a.js'});const snap=JSON.parse(before.slice(0,before.lastIndexOf('\n[код:')));
 await call('write_file',{path:'a.js',content:'changed'});const expected=crypto.createHash('sha256').update('changed').digest('hex');
 await writeFile(path.join(dir,'a.js'),'external');const conflict=await call('rollback_file',{path:'a.js',...snap,expected});assert.match(conflict,/Rollback conflict/);assert.equal(await readFile(path.join(dir,'a.js'),'utf8'),'external');
 await writeFile(path.join(dir,'a.js'),'changed');const success=await call('rollback_file',{path:'a.js',...snap,expected});assert.match(success,/\[код: 0\]/);assert.match(await readFile(path.join(dir,'a.js'),'utf8'),/function hello/);
});
