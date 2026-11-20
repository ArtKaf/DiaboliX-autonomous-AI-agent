import test from 'node:test';
import assert from 'node:assert/strict';
import { runStrategySearch } from '../strategy-search.js';

const base = () => ({ enabled:true, task:'Migrate the database safely', context:{ files:['db.js','server.js'] }, tree:'tree-a', getCurrentTree:async()=> 'tree-a' });
const proposals = JSON.stringify({ plans:['Add a backwards compatible migration with dual reads', 'Replace the storage adapter and migrate with a cutover'] });
const distinct = JSON.stringify({ distinct:true, first_strategy:'Use a backwards compatible migration', second_strategy:'Replace the storage adapter', difference:'The approaches have different rollout and storage designs.' });

test('search stays disabled by default, with no model or tree calls', async () => {
  let calls=0;
  assert.equal((await runStrategySearch({ ...base(), enabled:false, ask:async()=>{calls++;} })).status,'disabled');
  assert.equal(calls,0);
});

test('compares two strategies against current bounded context with bounded model options', async () => {
  const answers=[proposals,distinct,'{"score":0.8}', '{"score":0.3}'];
  let calls=0;
  const result=await runStrategySearch({...base(),ask:async(system,user,options)=>{calls++;assert.equal(options.maxOutputTokens,600);assert.ok(options.signal instanceof AbortSignal);assert.match(user,/db\.js/);return answers.shift();}});
  assert.equal(result.status,'ready');assert.equal(result.calls,4);assert.equal(calls,4);assert.match(result.plan,/backwards compatible/);assert.equal(result.diversity.status,'distinct');assert.match(result.notice,/unverified/);
});

test('single candidate is preserved after bounded duplicate attempts', async () => {
  let calls=0;
  const result=await runStrategySearch({...base(),ask:async()=>{calls++;return calls===1?'{"plans":["Migrate carefully", "Migrate carefully"]}':'{"plan":"Migrate carefully"}';}});
  assert.equal(result.status,'ready');assert.equal(result.plan,'Migrate carefully');assert.equal(result.diversity.status,'single_plan');assert.ok(calls<=6);
});

test('provider failure or exhausted budget never reports a selected plan', async () => {
  for (const options of [{maxCalls:1,ask:async()=>proposals},{ask:async()=>{throw Error('offline');}},{ask:async()=>'<tool_call>malformed'}]) {
    const result=await runStrategySearch({...base(),...options});assert.equal(result.status,'unavailable');assert.equal(result.plan,undefined);
  }
});

test('invalid model scores do not silently become fabricated neutral scores', async () => {
  const answers=[proposals,distinct,'{"score":"unknown"}'];
  const result=await runStrategySearch({...base(),ask:async()=>answers.shift()});
  assert.equal(result.status,'unavailable');assert.equal(result.plan,undefined);
});

test('rejects stale or unavailable workspace context', async () => {
  let calls=0;
  const pre=await runStrategySearch({...base(),getCurrentTree:async()=> 'other',ask:async()=>{calls++;}});assert.equal(pre.status,'stale');assert.equal(calls,0);
  let reads=0;const post=await runStrategySearch({...base(),getCurrentTree:async()=>++reads===1?'tree-a':'other',ask:async()=>'{"plans":["Migrate carefully"]}'});assert.equal(post.status,'stale');assert.equal(post.plan,undefined);
  assert.equal((await runStrategySearch({...base(),tree:'',ask:async()=>''})).status,'unavailable');
});

test('deadline stops waiting even for uncooperative providers', async () => {
  let passedSignal;
  const result=await runStrategySearch({...base(),timeoutMs:20,ask:async(_a,_b,{signal})=>{passedSignal=signal;return new Promise(()=>{});}});
  assert.equal(result.status,'unavailable');assert.equal(result.reason,'deadline');assert.equal(passedSignal.aborted,true);
});

test('explicit cancellation propagates and aborts provider signal', async () => {
  const controller=new AbortController();let providerSignal;
  const promise=runStrategySearch({...base(),signal:controller.signal,ask:async(_a,_b,{signal})=>{providerSignal=signal;controller.abort();return new Promise(()=>{});}});
  await assert.rejects(promise,{name:'AbortError'});assert.equal(providerSignal.aborted,true);
});
