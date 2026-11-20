import {test} from 'node:test';import assert from 'node:assert/strict';import {createLoopGuard,createReadCycleGuard} from '../loop-guard.js';
test('repeated tool calls with equivalent arguments are blocked',()=>{const guard=createLoopGuard();assert.equal(guard('read_file',{a:1,b:2}),true);assert.equal(guard('read_file',{b:2,a:1}),false);assert.equal(guard('search_code',{query:'x'}),true);assert.equal(guard('read_file',{a:1,b:2}),true)});
test('read cycle guard detects repeating two-step sequences with unchanged outputs',()=>{const guard=createReadCycleGuard();for(let i=0;i<2;i++){assert.equal(guard('search_code',{query:'a'},'found'),0);assert.equal(guard('read_file',{path:'a'},'text'),0)}assert.equal(guard('search_code',{query:'a'},'found'),0);assert.equal(guard('read_file',{path:'a'},'text'),1);assert.equal(guard('write_file',{},'changed'),0)});
test('read cycle warnings reset when genuinely new information appears',()=>{
 const guard=createReadCycleGuard();const cycle=()=>{let value;for(let i=0;i<3;i++){guard('search_code',{query:'a'},'src/a.js:1: const a=1');value=guard('read_file',{path:'src/a.js'},'1: const a=1')}return value};
 assert.equal(cycle(),1);assert.equal(guard('read_file',{path:'src/b.js'},'1: new file'),0);assert.equal(cycle(),1);assert.equal(guard('read_file',{path:'src/c.js'},'1: another file'),0);assert.equal(cycle(),1);
});
