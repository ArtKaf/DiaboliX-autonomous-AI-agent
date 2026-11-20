import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {summarize,compareReports} from '../eval/compare.js';
import {sourceFingerprint,fixtureHash,endpointFingerprint,FINGERPRINT_SCOPE} from '../eval/manifest.js';

test('evaluation summary counts timeouts, usage, latency and provider-reported cost honestly',()=>{
 const result=summarize({model:'m',engine:'frontier',results:[
  {id:'a',status:'passed',duration_ms:100,usage:{worker:{prompt:10,cached:4,completion:2,requests:2,elapsed_ms:35,provider_cost:0.3,provider_currency:'USD'}},events:[{type:'tool_result',name:'run_tests',outcome:{status:'error'}}]},
  {id:'b',status:'timeout',duration_ms:300}
 ]});
 assert.equal(result.engine,'frontier');assert.equal(result.passed,1);assert.equal(result.timeouts,1);assert.equal(result.mean_duration_ms,200);assert.equal(result.p50_duration_ms,100);assert.equal(result.p95_duration_ms,300);assert.equal(result.prompt_tokens,10);assert.equal(result.cached_tokens,4);assert.equal(result.completion_tokens,2);assert.equal(result.role_usage.worker.elapsed_ms,35);assert.deepEqual(result.provider_cost.reported_by_currency,{USD:0.3});assert.equal(result.provider_cost.incomplete,true);assert.deepEqual(result.failures_by_status,{timeout:1});assert.deepEqual(result.tool_errors_by_name,{run_tests:{error:1,timeout:0}});
 const absent=summarize({results:[{id:'x',status:'error'}]});assert.equal(absent.prompt_tokens,null);assert.deepEqual(absent.provider_cost.reported_by_currency,{});assert.equal(absent.provider_cost.incomplete,true);assert.equal(summarize({results:[{id:'x',status:'error',usage:{worker:{prompt:0,completion:0}}}]}).provider_cost.incomplete,true);
 const mixed=summarize({results:[{id:'x',status:'passed',usage:{worker:{prompt:1,provider_cost:1,provider_currency:'USD'},reviewer:{prompt:2,provider_cost:2,provider_currency:'EUR'}}}]});assert.deepEqual(mixed.provider_cost.reported_by_currency,{EUR:2,USD:1});assert.equal(mixed.provider_cost.incomplete,false);
});

test('historic evaluation reports retain their recorded engine label but cannot imply controlled comparability',()=>{
 assert.equal(summarize({execution_mode:'quick',results:[]}).engine,'quick');const result=compareReports([{model:'m',results:[]},{model:'m',results:[]}]);assert.equal(result.comparable,false);assert.match(result.reasons.join(' '),/manifest/);assert.deepEqual(result.pairwise,[]);
});

function report({statuses=['passed','failed'],source='a'.repeat(64),revision='release-v1'}={}){
 const hash='b'.repeat(64),conditions={model:'model',model_revision:revision,endpoint_sha256:'c'.repeat(64),timeout_ms:240000,repeats:2,max_steps:12,profile:'coding',mcp:'disabled',computer:'disabled',network:'offline',node:'v22',platform:'linux',architecture:'x64',kernel:'test',host_cpu_model:'fixture cpu',host_cpu_count:4,host_memory_bytes:4096,sandbox_engine_version:'test-engine',sandbox_image_id:'sha256:'+'d'.repeat(64)};
 return {model:'model',engine:'frontier',manifest:{version:1,kind:'synthetic-coding-fixtures',fixtures:[{id:'task',sha256:hash}],conditions,harness:{source_sha256:source,source_changed_during_run:false,fingerprint_scope:FINGERPRINT_SCOPE}},results:statuses.map((status,index)=>({id:'task',attempt:index+1,fixture_hash:hash,status,duration_ms:100+index*100}))};
}

test('A/B reports require matching recorded conditions and reveal paired changes',()=>{
 const first=report(),second=report({statuses:['failed','passed'],source:'e'.repeat(64)}),result=compareReports([first,second]);
 assert.equal(result.comparable,true);assert.equal(result.source_changed_between_reports,true);assert.deepEqual(result.pairwise[0],{report:2,improved:1,regressed:1,unchanged:0,passed_delta:0,mean_duration_delta_ms:0});assert.match(result.notice,/stochastic/);
 const malformed=structuredClone(second);malformed.manifest.fixtures=[null];assert.match(compareReports([first,malformed]).reasons.join(' '),/fixture fingerprints/);
 const invalidAttempt=structuredClone(second);invalidAttempt.results[0]=null;assert.match(compareReports([first,invalidAttempt]).reasons.join(' '),/invalid attempt/);
 const injected=summarize({results:[{id:'__proto__',status:'__proto__'}]});assert.equal(injected.per_case['__proto__'].attempts,1);assert.equal(injected.failures_by_status['__proto__'],1);
 const scope=structuredClone(second);scope.manifest.harness.fingerprint_scope='different policy';assert.match(compareReports([first,scope]).reasons.join(' '),/scope differs/);
 const noScope=structuredClone(second);delete noScope.manifest.harness.fingerprint_scope;assert.match(compareReports([first,noScope]).reasons.join(' '),/unknown source fingerprint scope/);
 const mismatch=structuredClone(second);mismatch.manifest.conditions.timeout_ms=100;assert.equal(compareReports([first,mismatch]).comparable,false);assert.match(compareReports([first,mismatch]).reasons.join(' '),/timeout_ms/);
 const unpinned=report({revision:null});assert.equal(compareReports([first,unpinned]).comparable,false);assert.match(compareReports([first,unpinned]).reasons.join(' '),/model_revision/);
 const alteredModel=structuredClone(second);alteredModel.model='different';assert.match(compareReports([first,alteredModel]).reasons.join(' '),/model differs from manifest/);
 const missingTiming=structuredClone(second);delete missingTiming.results[0].duration_ms;assert.equal(compareReports([first,missingTiming]).pairwise[0].mean_duration_delta_ms,null);
 const changed=structuredClone(second);changed.manifest.harness.source_changed_during_run=true;assert.equal(compareReports([first,changed]).comparable,false);
 const missing=structuredClone(second);missing.results.pop();assert.match(compareReports([first,missing]).reasons.join(' '),/incomplete attempts/);
 const duplicate=structuredClone(second);duplicate.results[1].attempt=1;assert.match(compareReports([first,duplicate]).reasons.join(' '),/duplicated/);
 const badFixture=structuredClone(second);badFixture.results[0].fixture_hash='f'.repeat(64);assert.match(compareReports([first,badFixture]).reasons.join(' '),/mismatched attempt/);
});

test('evaluation manifests fingerprint source and fixtures without reading local configuration',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-manifest-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'sandbox'));await mkdir(path.join(dir,'eval'));await writeFile(path.join(dir,'server.js'),'original');await writeFile(path.join(dir,'package.json'),'{}');for(const file of ['run.js','cases.js','manifest.js','compare.js'])await writeFile(path.join(dir,'eval',file),file);await writeFile(path.join(dir,'config.local.json'),'do not include');await writeFile(path.join(dir,'sandbox','worker.cjs'),'worker');await writeFile(path.join(dir,'sandbox','config.local.js'),'private local config');await writeFile(path.join(dir,'sandbox','secret-store.js'),'private token');await writeFile(path.join(dir,'sandbox','other.json'),'private arbitrary json');await mkdir(path.join(dir,'mcp'));await mkdir(path.join(dir,'mcp','credentials'));await writeFile(path.join(dir,'mcp','credentials','module.js'),'private');await symlink(path.join(dir,'config.local.json'),path.join(dir,'sandbox','credentials.json'));await symlink(path.join(dir,'config.local.json'),path.join(dir,'sandbox','server.local.js'));
 const first=await sourceFingerprint(dir);assert.equal(first.status,'available');await writeFile(path.join(dir,'config.local.json'),'private changed');await writeFile(path.join(dir,'sandbox','config.local.js'),'changed');await writeFile(path.join(dir,'sandbox','secret-store.js'),'changed');await writeFile(path.join(dir,'sandbox','other.json'),'changed');await writeFile(path.join(dir,'mcp','credentials','module.js'),'changed');assert.equal((await sourceFingerprint(dir)).sha256,first.sha256);await writeFile(path.join(dir,'server.js'),'changed');assert.notEqual((await sourceFingerprint(dir)).sha256,first.sha256);await symlink(path.join(dir,'config.local.json'),path.join(dir,'sandbox','source.cjs'));assert.equal((await sourceFingerprint(dir)).status,'unavailable');
 const sample={id:'test',task:'fix',files:{'a.js':'1'},check:'test'};assert.equal(fixtureHash(sample),fixtureHash(structuredClone(sample)));assert.notEqual(fixtureHash(sample),fixtureHash({...sample,check:'different'}));
 assert.equal(endpointFingerprint('https://u:password@example.test/v1?key=secret'),null);assert.equal(endpointFingerprint('https://example.test/v1?api-version=2'),null);assert.notEqual(endpointFingerprint('https://example.test/v2'),endpointFingerprint('https://example.test/v1'));
});
