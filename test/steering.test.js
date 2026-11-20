import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SteeringQueue} from '../steering.js';

const firstId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',secondId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('queued user clarifications are delivered once in arrival order, with idempotent HTTP retries',()=>{
 const queue=new SteeringQueue();const first=queue.enqueue('Keep the old API',firstId);assert.equal(first.duplicate,false);assert.equal(queue.enqueue('Keep the old API',firstId).duplicate,true);assert.throws(()=>queue.enqueue('Change the API',firstId),/уже использован/);
 queue.enqueue('Also retain the existing tests',secondId);assert.equal(queue.hasPending(),true);assert.equal(queue.revision(),2);assert.deepEqual(queue.claim().map(x=>x.text),['Keep the old API','Also retain the existing tests']);assert.equal(queue.hasPending(),false);assert.equal(queue.hasClaimed(),true);assert.throws(()=>queue.claim(),/ещё не подтверждены/);assert.equal(queue.acknowledge().length,2);assert.equal(queue.hasClaimed(),false);assert.deepEqual(queue.claim(),[]);
});
test('release preserves ordering when a delivery attempt cannot be completed',()=>{const queue=new SteeringQueue();queue.enqueue('one',firstId);const claimed=queue.claim();claimed[0].text='changed externally';queue.enqueue('two',secondId);assert.equal(queue.release(),true);assert.deepEqual(queue.claim().map(x=>x.text),['one','two']);queue.acknowledge();assert.equal(queue.release(),false)});
test('close differentiates queued and in-flight messages and rejects late sends',()=>{const queue=new SteeringQueue();queue.enqueue('one',firstId);queue.claim();queue.enqueue('two',secondId);const result=queue.close();assert.deepEqual(result.unconfirmed.map(x=>x.id),[firstId]);assert.deepEqual(result.undelivered.map(x=>x.id),[secondId]);assert.throws(()=>queue.enqueue('late'),/уже завершена/);assert.throws(()=>queue.claim(),/уже завершена/);assert.deepEqual(queue.close(),{undelivered:[],unconfirmed:[]})});
test('validates scope and bounds while retaining pending messages',()=>{const queue=new SteeringQueue({maxPending:1,maxAccepted:2,maxLength:4});for(const text of ['', '   ','12345'])assert.throws(()=>queue.enqueue(text));assert.throws(()=>queue.enqueue('ok','../bad'));queue.enqueue('one',firstId);assert.throws(()=>queue.enqueue('two',secondId),/очередь/i);assert.equal(queue.claim()[0].text,'one');queue.acknowledge();queue.enqueue('two',secondId);assert.throws(()=>queue.enqueue('last'),/количество/);assert.deepEqual(queue.close().undelivered.map(x=>x.text),['two'])});
test('a direction arriving during a tool call waits for completion and makes later calls skippable',async()=>{
 const queue=new SteeringQueue(),observed=[];let unblock,started;
 const began=new Promise(resolve=>{started=resolve}),barrier=new Promise(resolve=>{unblock=resolve});
 const runBatch=async()=>{for(const call of ['first','second']){if(queue.hasPending()){observed.push('skipped:'+call);continue}observed.push('started:'+call);if(call==='first'){started();await barrier}observed.push('finished:'+call)}};
 const running=runBatch();await began;queue.enqueue('Change strategy',firstId);assert.deepEqual(observed,['started:first']);unblock();await running;
 assert.deepEqual(observed,['started:first','finished:first','skipped:second']);assert.equal(queue.claim()[0].text,'Change strategy');queue.acknowledge();
});
