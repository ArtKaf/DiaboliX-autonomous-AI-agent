import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontierContext} from '../frontier-context.js';
import {surveyRanks} from '../survey-context.js';

const snapshot=files=>({tree:'tree-current',inventory:{files:files.map(([path,status='unchanged'])=>({path,status})),has_more:false},changes:{files:files.filter(([,status])=>status&&status!=='unchanged').map(([path,status])=>({path,status})),has_more:false},diff:{diff:'',truncated:false}});

test('uses task-related symbols, source words and approximate imports as bounded ranking hints without leaking source',()=>{
 const s=snapshot([['src/handler.js'],['src/identity.js'],['src/unused.js']]);
 const survey=[{path:'src/handler.js',content:'import { validateSession } from "./identity.js"; export function handler() {}',nodes:[{name:'handler'}]},
 {path:'src/identity.js',content:'const accessControl = "private-SENTINEL-123"; export function validateSession() { return true }',nodes:[{name:'validateSession'}]},
 {path:'src/unused.js',content:'const anything = 12;',nodes:[]}];
 const out=frontierContext({task:'Fix session validation',snapshot:s,survey});
 const names=out.relevant_files.map(x=>x.path);assert.ok(names.includes('src/identity.js'));assert.ok(names.includes('src/handler.js'));
 assert.ok(names.indexOf('src/identity.js')<names.indexOf('src/handler.js'));assert.ok(!names.includes('src/unused.js'));
 assert.doesNotMatch(JSON.stringify(out),/private-SENTINEL|validateSession|accessControl|import \{/);
 assert.match(out.notice,/historical startup survey/);
});

test('does not rank changed/deleted source from stale survey metadata',()=>{
 const s=snapshot([['src/a.js','M'],['src/b.js','D'],['src/c.js']]);
 const survey=[{path:'src/a.js',content:'export function authMagic(){}',nodes:[{name:'authMagic'}]},{path:'src/b.js',content:'export function authMagic(){}',nodes:[{name:'authMagic'}]},{path:'src/c.js',content:'export const x = 1;',nodes:[]}];
 const ranks=surveyRanks(survey,'authMagic',s.inventory.files,s.changes.files);assert.equal(ranks.has('src/a.js'),false);assert.equal(ranks.has('src/b.js'),false);
 const out=frontierContext({task:'authMagic',snapshot:s,survey});assert.ok(!out.relevant_files.some(f=>f.path==='src/a.js'||f.path==='src/b.js'));
});

test('survey ranking safely ignores malformed input and cannot prove missing files',()=>{
 const s=snapshot([['src/main.js']]);s.inventory.has_more=true;
 const survey=[null,{path:'../outside',content:'accountRecovery'},{path:'/outside',content:'accountRecovery'},{path:'src/missing.js',content:'accountRecovery'},{path:'src/main.js',content:'const accountRecovery = true'}];
 const out=frontierContext({task:'accountRecovery',snapshot:s,survey});assert.deepEqual(out.relevant_files.map(x=>x.path),['src/main.js']);assert.equal(out.inventory_partial,true);assert.match(out.notice,/absence is not proof/);
 const noSurvey=frontierContext({task:'main.js',snapshot:s,survey:null});assert.equal(noSurvey.relevant_files[0].path,'src/main.js');
});

test('matches JS/TS index candidates and inbound references to changed files',()=>{
 const files=[['src/entry.js'],['src/session/index.ts','M'],['src/other.js']];const s=snapshot(files);
 const survey=[{path:'src/entry.js',content:'import { session } from "./session";',nodes:[]},{path:'src/session/index.ts',content:'export const session = true;',nodes:[]},{path:'src/other.js',content:'export const other = true;',nodes:[]}];
 const ranks=surveyRanks(survey,'update',s.inventory.files,s.changes.files);assert.ok(ranks.get('src/entry.js')>0);assert.ok(!ranks.has('src/other.js'));
});

test('does not inspect startup contents absent from current Shadow Git inventory',()=>{
 const blocked={path:'.env',get content(){throw Error('excluded file content must not be read')}};
 const protectedConfig={path:'private-settings.json',get content(){throw Error('protected file content must not be read')}};
 const survey=[blocked,protectedConfig,{path:'src/app.js',content:'function boot() {}',nodes:[]}];
 const view=frontierContext({task:'boot',survey,snapshot:snapshot([['src/app.js']])});
 assert.deepEqual(view.relevant_files.map(x=>x.path),['src/app.js']);assert.doesNotMatch(JSON.stringify(view),/private-settings|\.env/);
});

test('navigation index ranks only current inventory and retains memory as untrusted partial context',()=>{
 const s=snapshot([['src/handler.js'],['src/other.js']]);
 const out=frontierContext({task:'handle access',snapshot:s,indexHints:{files:[{path:'src/handler.js',score:12},{path:'src/deleted.js',score:90}],partial:true,notice:'index is stale or incomplete'},projectMemory:{items:[{kind:'decision',text:'Use sessions',trust:'model_interpretation',freshness:'unknown'}],partial:false,notice:'untrusted'}});
 assert.deepEqual(out.relevant_files.map(f=>f.path),['src/handler.js']);assert.equal(out.navigation_index.partial,true);assert.equal(out.project_memory.items[0].trust,'model_interpretation');
});

test('only verified index hints may add paths beyond a partial inventory',()=>{
 const s=snapshot([['src/a.js']]);s.inventory.has_more=true;
 const hints={files:[{path:'src/z.js',score:10}],partial:true,notice:'Snapshot only'};
 assert.equal(frontierContext({task:'z.js',snapshot:s,indexHints:hints}).relevant_files.length,0);
 const out=frontierContext({task:'z.js',snapshot:s,indexHints:{...hints,snapshot_verified:true}});
 assert.equal(out.relevant_files[0].path,'src/z.js');assert.equal(out.relevant_files[0].index_snapshot_match,true);assert.equal(out.relevant_files[0].status,'unknown');assert.equal(out.inventory_partial,true);
});
