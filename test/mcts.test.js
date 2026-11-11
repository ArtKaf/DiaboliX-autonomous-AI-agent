import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePlan } from '../mcts.js';
test('MCTS explores both candidate plans and selects the higher scoring branch',async()=>{
 let n=0;const result=await choosePlan('task',async(_prompt,input)=>{n++;if(n===1)return JSON.stringify({plans:['A','B']});return JSON.stringify({score:input.includes('"A"')?0.9:0.1});});
 assert.equal(result.plan,'A');assert.equal(result.branches.reduce((s,b)=>s+b.visits,0),4);assert.ok(result.branches.every(b=>b.visits>0));
});
