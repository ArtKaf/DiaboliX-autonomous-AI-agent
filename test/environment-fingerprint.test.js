import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {captureEnvironment,compareEnvironment,ENVIRONMENT_FILES} from '../environment-fingerprint.js';

const id='sha256:'+'a'.repeat(64),id2='sha256:'+'b'.repeat(64);
async function workspace(t){const dir=await mkdtemp(path.join(os.tmpdir(),'diab-env-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
const take=(dir,options={})=>captureEnvironment(dir,{imageId:id,...options});

test('partial environment compares manifest bytes, missing files, and immutable image identity without leaking contents',async t=>{
 const dir=await workspace(t);await writeFile(path.join(dir,'package.json'),'{"name":"example", "version":"1.0.0"}\n');await writeFile(path.join(dir,'package-lock.json'),'{"token":"private-value-should-not-appear"}\n');
 const a=await take(dir),b=await take(dir);assert.equal(a.scope,'partial');assert.equal(a.complete,true);assert.equal(a.files.length,ENVIRONMENT_FILES.length);assert.equal(compareEnvironment(a,b).status,'unchanged');assert.doesNotMatch(JSON.stringify(a),/private-value|example|diab-env-/);assert.match(a.limitations.join(' '),/node_modules/);
 await writeFile(path.join(dir,'package.json'),'{"name":"example", "version":"2.0.0"}\n');await writeFile(path.join(dir,'go.mod'),'module example.test/project\n');const c=await take(dir,{imageId:id2});const result=compareEnvironment(a,c);assert.equal(result.status,'changed');assert.deepEqual(result.changed,['sandbox_image','package.json','go.mod']);
});

test('changes outside the explicitly partial environment scope are never presented as full freshness',async t=>{
 const dir=await workspace(t);await mkdir(path.join(dir,'node_modules'));await writeFile(path.join(dir,'node_modules','dynamic.js'),'one');const a=await take(dir);await writeFile(path.join(dir,'node_modules','dynamic.js'),'two');const result=compareEnvironment(a,await take(dir));assert.equal(result.status,'unchanged');assert.equal(result.scope,'partial');assert.match(result.limitations.join(' '),/may change unnoticed/);
});

test('invalid JSON, symlinks and oversized manifests are unknown even if unchanged',async t=>{
 const dir=await workspace(t);await writeFile(path.join(dir,'package.json'),'{invalid');await symlink('nonexistent',path.join(dir,'yarn.lock'));await writeFile(path.join(dir,'go.mod'),'x'.repeat(1024*1024+1));const a=await take(dir),b=await take(dir);
 assert.equal(a.complete,false);assert.equal(a.files.find(f=>f.path==='package.json').reason,'invalid_json');assert.equal(a.files.find(f=>f.path==='yarn.lock').reason,'symlink');assert.equal(a.files.find(f=>f.path==='go.mod').reason,'too_large');assert.equal(compareEnvironment(a,b).status,'unknown');
});

test('JSONC config with comments, quoted slashes and trailing commas is accepted; broken JSONC is unknown',async t=>{
 const dir=await workspace(t),file=path.join(dir,'tsconfig.json');await writeFile(file,'{\n // comment\n "compilerOptions": {"rootDir":"src//path",}, /* note */\n}\n');const valid=await take(dir);assert.equal(valid.complete,true);assert.equal(valid.files.find(f=>f.path==='tsconfig.json').state,'file');await writeFile(file,'{ "compilerOptions": { /* not closed');const broken=await take(dir);assert.equal(broken.files.find(f=>f.path==='tsconfig.json').reason,'invalid_json');assert.equal(compareEnvironment(valid,broken).status,'unknown');
});

test('missing immutable image ID, different scope and damaged snapshots cannot become unchanged',async t=>{
 const dir=await workspace(t);await mkdir(path.join(dir,'frontend'));const valid=await take(dir),unknownTag=await take(dir,{imageId:'node:22-bookworm'});assert.equal(unknownTag.complete,false);assert.equal(compareEnvironment(unknownTag,unknownTag).status,'unknown');assert.equal(compareEnvironment(valid,await take(dir,{roots:['.','frontend']})).status,'unknown');
 for(const mutated of [{...valid,files:valid.files.slice(1)},{...valid,files:valid.files.map((x,i)=>i===0?{...x,state:'file',sha256:'bad',bytes:1}:x)},{...valid,image:{state:'observed',id:'fake'}}])assert.equal(compareEnvironment(mutated,valid).status,'unknown');
});

test('symlinked, excluded, missing and escaping project roots fail closed',async t=>{
 const dir=await workspace(t);await mkdir(path.join(dir,'actual'));await symlink('actual',path.join(dir,'link'));for(const roots of [['link'],['missing'],['../outside'],['.git'],['node_modules']]){const snap=await take(dir,{roots});assert.equal(snap.complete,false,JSON.stringify(roots));assert.equal(compareEnvironment(snap,snap).status,'unknown')}
});

test('matching manifests in a different workspace never establish environment freshness',async t=>{
 const first=await workspace(t),second=await workspace(t);await writeFile(path.join(first,'package.json'),'{"name":"same"}');await writeFile(path.join(second,'package.json'),'{"name":"same"}');const a=await take(first),b=await take(second);assert.equal(a.complete,true);assert.equal(b.complete,true);assert.notEqual(a.workspace_id,b.workspace_id);assert.equal(compareEnvironment(a,b).status,'unknown');assert.doesNotMatch(JSON.stringify(a),/diab-env-/);
});
