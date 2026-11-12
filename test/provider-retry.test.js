import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withProviderRetries} from '../provider-retry.js';

test('provider retries ten times at 30-second intervals and then returns the error',async()=>{
 let calls=0;const waits=[],events=[];
 await assert.rejects(withProviderRetries(async()=>{calls++;throw Error('API unavailable')},{wait:async(ms)=>waits.push(ms),onRetry:event=>events.push(event.attempt)}),/API unavailable/);
 assert.equal(calls,11);assert.deepEqual(events,[1,2,3,4,5,6,7,8,9,10]);assert.deepEqual(waits,Array(10).fill(30000));
});
test('provider retries can recover and cancellation interrupts the wait',async()=>{
 let calls=0;assert.equal(await withProviderRetries(async()=>{if(++calls<3)throw Error('temporary');return 'ok'},{wait:async()=>{}}),'ok');assert.equal(calls,3);
 const controller=new AbortController();let attempts=0;const pending=withProviderRetries(async()=>{attempts++;throw Error('unavailable')},{signal:controller.signal,onRetry:()=>controller.abort()});
 await assert.rejects(pending);assert.equal(attempts,1);
});
test('provider can bypass retries for unsupported reviewer images',async()=>{
 let calls=0;await assert.rejects(withProviderRetries(async()=>{calls++;throw Error('unsupported image')},{shouldRetry:()=>false,wait:async()=>assert.fail('unexpected retry')}),/unsupported image/);assert.equal(calls,1);
});
