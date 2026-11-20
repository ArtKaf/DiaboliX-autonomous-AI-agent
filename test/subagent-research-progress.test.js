import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runIsolatedSubagent} from '../subagent-runner.js';

const definition=(name,properties,required=[])=>({type:'function',function:{name,parameters:{type:'object',properties,required}}});
const tools=[definition('read_file',{path:{type:'string'},start_line:{type:'integer'},end_line:{type:'integer'}},['path']),definition('write_file',{path:{type:'string'},content:{type:'string'}},['path','content'])];
const call=(name,args,n)=>({role:'assistant',content:null,tool_calls:[{id:`call-${n}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const base=()=>({task:'Implement assigned task',paths:['src'],directory:'/unused',signal:new AbortController().signal,tools});

test('a subagent may read more than 24 useful windows and 12 model turns',async()=>{
 let turns=0,reads=0,acquired=0;
 const result=await runIsolatedSubagent({...base(),acquireStep:()=>{acquired++;return acquired<=45},ask:async()=>{turns++;if(turns>30)return {content:'Finished useful research.'};return call('read_file',{path:'src/large.js',start_line:turns,end_line:turns},turns)},sandboxTool:async(_name,args)=>{reads++;return `Всего строк: 30, показано: ${args.start_line}–${args.end_line}\n${args.start_line}: line ${args.start_line}\n[код: 0]`}});
 assert.equal(result,'Finished useful research.');assert.equal(reads,30);assert.equal(turns,31);assert.equal(acquired,31);
});

test('a repeated research call can return new content and sustained unchanged results stop the loop',async()=>{
 let turns=0,reads=0;const seen=[];
 const result=await runIsolatedSubagent({...base(),acquireStep:()=>turns<40,ask:async messages=>{turns++;for(const m of messages)if(m.role==='tool')seen.push(m.content);return call('read_file',{path:'src/file.js',start_line:1,end_line:1},turns)},sandboxTool:async()=>{reads++;return `Всего строк: 1, показано: 1–1\n1: ${reads===1?'old':'new'}\n[код: 0]`}});
 assert.ok(reads>2,'the same call was retried and could observe changed contents');assert.ok(reads<30,'repeated unchanged results are bounded');assert.match(result,/no new information/i);assert.ok(seen.some(x=>/no new information/i.test(x)),'worker received a warning before stopping');
});

test('the shared task step budget remains active during productive research',async()=>{
 let turns=0,steps=0;
 const result=await runIsolatedSubagent({...base(),acquireStep:()=>++steps<=15,ask:async()=>{turns++;return call('read_file',{path:`src/file${turns}.js`},turns)},sandboxTool:async(_name,args)=>`Всего строк: 1, показано: 1–1\n1: ${args.path}\n[код: 0]`});
 assert.equal(turns,15);assert.match(result,/shared task step budget/i);
});

test('non-research actions remain bounded independently',async()=>{
 let actions=0,turns=0;
 const result=await runIsolatedSubagent({...base(),acquireStep:()=>true,ask:async()=>{turns++;return call('write_file',{path:`src/${turns}.js`,content:'ok'},turns)},sandboxTool:async(name)=>{if(name==='write_file')actions++;return '\n[код: 0]'}});
 assert.equal(actions,12);assert.match(result,/action limit/i);
});

test('test prohibition is enforced for commands as well as the run_tests tool',async()=>{
 let turns=0,executed=0,blocked='';const commands=[...tools,definition('run_command',{command:{type:'string'}},['command'])];
 const result=await runIsolatedSubagent({...base(),tools:commands,testsAllowed:false,ask:async messages=>{turns++;if(turns===1)return call('run_command',{command:'node --test'},turns);blocked=messages.find(m=>m.role==='tool')?.content;return {content:'Tests were not run.'}},sandboxTool:async()=>{executed++;return '\n[код: 0]'}});
 assert.equal(executed,0);assert.match(blocked,/prohibited/i);assert.equal(result,'Tests were not run.');
});
