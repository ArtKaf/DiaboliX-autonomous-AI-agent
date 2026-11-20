import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchProgressGuard,isResearchObservation} from '../loop-guard.js';

test('structured navigation counts observed symbols, not changed query or pagination metadata',()=>{
 const guard=createResearchProgressGuard(),args={path:'src/main.ts',action:'symbols',query:'x'};
 const first=JSON.stringify({path:'src/main.ts',hash:'abc',symbols:[{name:'x',range:{line:1}}],next_offset:2,notice:'one'});
 const same=JSON.stringify({path:'src/main.ts',hash:'abc',symbols:[{name:'x',range:{line:1}}],next_offset:40,notice:'two'});
 assert.equal(guard('code_navigation',args,first).novel,true);
 assert.equal(guard('code_navigation',{...args,query:'xy'},same).novel,false);
 const next=JSON.stringify({path:'src/main.ts',hash:'abc',symbols:[{name:'y',range:{line:4}}],next_offset:null});
 assert.equal(guard('code_navigation',args,next).novel,true);
});

test('parallel reads recognize repeated facts even when journal event IDs change',()=>{
 const guard=createResearchProgressGuard(),args={operations:[{name:'read_file',args:{path:'src/a.js'}},{name:'search_code',args:{query:'x'}}]};
 const result=(id,line='const x=1;')=>JSON.stringify({results:[{name:'read_file',event_id:id,outcome:{status:'success'},output:`Всего строк: 1, показано: 1–1\n1: ${line}\n[код: 0]`},{name:'search_code',event_id:id+1,outcome:{status:'success'},output:`src/a.js:1: ${line}\n[код: 0]`}]});
 assert.equal(guard('parallel_read',args,result(1)).novel,true);
 assert.equal(guard('parallel_read',args,result(20)).novel,false);
 assert.equal(guard('parallel_read',args,result(40,'const x=2;')).novel,true);
});

test('research guard ignores mutations, handles failed observations and can reset a stalled streak',()=>{
 const guard=createResearchProgressGuard({warningAfter:2,stopAfter:3,maxFacts:10});assert.equal(isResearchObservation('write_file'),false);
 assert.equal(guard('read_file',{path:'a'},'Error: denied',{failed:true}).streak,1);
 assert.equal(guard('read_file',{path:'a'},'Ошибка: denied').warning,true);
 assert.equal(guard('write_file',{path:'a'},'ok'),null);
 guard.reset();assert.equal(guard('read_file',{path:'a'},'Error: denied',{failed:true}).streak,1);
});

test('LSP locations and scoped negative navigation results carry distinct observations',()=>{
 const guard=createResearchProgressGuard(),args={path:'src/main.ts',action:'references',line:1,column:1};
 const result=locations=>JSON.stringify({path:'src/main.ts',hash:'abc',locations});
 assert.equal(guard('code_navigation',args,result([{path:'src/a.ts',range:{start:{line:2}}}])).novel,true);
 assert.equal(guard('code_navigation',{...args,line:3},result([{path:'src/a.ts',range:{start:{line:2}}}])).novel,false);
 assert.equal(guard('code_navigation',args,result([{path:'src/b.ts',range:{start:{line:2}}}])).novel,true);
 assert.equal(guard('code_navigation',args,result([])).novel,true);
 assert.equal(guard('code_navigation',args,result([])).novel,false);
 assert.equal(guard('code_navigation',{...args,line:3},result([])).novel,true);
});

test('individual historic decisions and partial diagnostic errors are observations, not volatile IDs',()=>{
 const guard=createResearchProgressGuard();
 const historical=text=>JSON.stringify({source:{kind:'decision',text,source:{run_id:'old',event_id:42}},notice:'untrusted'});
 assert.equal(guard('project_memory',{},historical('First decision')).novel,true);
 assert.equal(guard('project_memory',{},historical('First decision')).novel,false);
 assert.equal(guard('project_memory',{},historical('Another decision')).novel,true);
 const listing=error=>JSON.stringify({modules:[],errors:[{path:'src/a.ts',reason:error}],next_offset:3});
 assert.equal(guard('module_map',{},listing('Parse failed')).novel,true);
 assert.equal(guard('module_map',{},listing('Parse failed')).novel,false);
 assert.equal(guard('module_map',{},listing('Permission denied')).novel,true);
 assert.equal(guard('module_map',{},listing('Malformed output'),{failed:true}).novel,false);
});

test('project_state reports changed tests and diagnostics without treating repeated error IDs as new',()=>{
 const guard=createResearchProgressGuard(),base={tree:'fixed',files:[{path:'src/main.js',status:'M'}],tests:{status:'not_run'},project_diagnostics:null,post_edit_diagnostics:[],recent_tool_errors:[]};
 assert.equal(guard('project_state',{},JSON.stringify(base)).novel,true);
 const changed={...base,tests:{status:'success',fresh:true},project_diagnostics:{status:'completed',checked:1,problems:0},post_edit_diagnostics:[{path:'src/main.js',status:'passed'}],recent_tool_errors:[{tool:'search_code',status:'error',event_id:1}]};
 assert.equal(guard('project_state',{},JSON.stringify(changed)).novel,true);
 const duplicate={...changed,recent_tool_errors:[{tool:'search_code',status:'error',event_id:2},{tool:'search_code',status:'error',event_id:3}]};
 assert.equal(guard('project_state',{},JSON.stringify(duplicate)).novel,false);
 assert.equal(guard('project_state',{},JSON.stringify({...duplicate,project_diagnostics:{status:'issues',checked:1,problems:1}})).novel,true);
 assert.equal(guard('project_state',{},JSON.stringify({...duplicate,post_edit_diagnostics:[{path:'src/main.js',status:'failed'}]})).novel,true);
});

test('file line-count changes are observed even when displayed lines are unchanged',()=>{
 const guard=createResearchProgressGuard(),args={path:'file.js',start_line:1,end_line:1};
 const output=(count,range='1–1')=>`Всего строк: ${count}, показано: ${range}\n1: unchanged\n[код: 0]`;
 assert.equal(guard('read_file',args,output(2)).novel,true);
 assert.equal(guard('read_file',{...args,end_line:2},output(2,'1–2')).novel,false);
 assert.equal(guard('read_file',args,output(3)).novel,true);
});
