import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchProgressGuard} from '../loop-guard.js';

const read=(path,start,end,lines)=>({name:'read_file',args:{path,start_line:start,end_line:end},result:`Всего строк: 500, показано: ${start}–${end}\n${lines.map(([n,v])=>`${n}: ${v}`).join('\n')}\n[код: 0]`});
const observe=(guard,x)=>guard(x.name,x.args,x.result);

test('arbitrarily many distinct file windows remain productive without a call-count ceiling',()=>{
 const guard=createResearchProgressGuard();
 for(let i=1;i<=120;i++){
  const result=observe(guard,read('src/big.js',i,i,[[i,`const value${i} = ${i};`]]));
  assert.equal(result?.novel,true,`line ${i} should be new information`);assert.equal(result.warning,false);assert.equal(result.stop,false);
 }
});

test('overlapping windows and alternate search arguments cannot disguise repeated observations',()=>{
 const guard=createResearchProgressGuard();
 assert.equal(observe(guard,read('src/a.js',1,2,[[1,'alpha'],[2,'beta']])).novel,true);
 assert.equal(observe(guard,read('/workspace/src/a.js',2,2,[[2,'beta']])).novel,false);
 const search=guard('search_code',{query:'beta'},'src/a.js:2: beta\n[код: 0]');assert.equal(search?.novel,false);
 let warned=false,stopped=false;for(let i=0;i<30&&!stopped;i++){const r=observe(guard,read('src/a.js',2,2,[[2,'beta']]));warned||=!!r.warning;stopped=!!r.stop;}
 assert.equal(warned,true,'unproductive repeated calls must be flagged');assert.equal(stopped,true,'continued unproductive calls must not loop forever');
});

test('new lines and changed file contents reset stalled progress; errors are not new information',()=>{
 const guard=createResearchProgressGuard();const first=read('x.js',1,1,[[1,'old']]);assert.equal(observe(guard,first).novel,true);assert.equal(observe(guard,first).novel,false);
 const second=observe(guard,read('x.js',1,2,[[1,'old'],[2,'new']]));assert.equal(second.novel,true);assert.equal(second.streak,0);assert.equal(second.stop,false);
 assert.equal(observe(guard,read('x.js',1,1,[[1,'changed']])).novel,true);
 const failed=guard('read_file',{path:'x.js'},'Error: file unavailable',{failed:true});assert.equal(failed?.novel,false);
 assert.equal(guard('write_file',{path:'x.js'},'ok'),null);
});

test('negative search results are new only for a genuinely different query or search mode',()=>{
 const guard=createResearchProgressGuard(),none='Совпадений не найдено\n[код: 0]';
 const a={path:'src',query:'missing_one'},b={path:'src',query:'missing_two'};
 assert.equal(guard('search_code',a,none).novel,true);
 assert.equal(guard('search_code',{query:'missing_one',path:'src'},none).novel,false);
 assert.equal(guard('search_code',b,none).novel,true);
 assert.equal(guard('search_code',{...b,regex:true},none).novel,true);
 assert.equal(guard('search_code',{...b,regex:true},none).novel,false);
 assert.equal(guard('search_code',{...b,regex:true,case_sensitive:true},none).novel,true);
});

test('navigation preserves distinct negative lookups but deduplicates identical locations',()=>{
 const guard=createResearchProgressGuard(),emptySymbols=JSON.stringify({path:'src/a.ts',hash:'same',language:'typescript',symbols:[]});
 const symbols=name=>({path:'src/a.ts',action:'symbols',query:name});
 assert.equal(guard('code_navigation',symbols('missing_alpha'),emptySymbols).novel,true);
 assert.equal(guard('code_navigation',symbols('missing_alpha'),emptySymbols).novel,false);
 assert.equal(guard('code_navigation',symbols('missing_beta'),emptySymbols).novel,true);
 const emptyLocations=JSON.stringify({path:'src/a.ts',hash:'same',language:'typescript',locations:[]});
 const definition=(line,column=1)=>({path:'src/a.ts',action:'definition',line,column});
 assert.equal(guard('code_navigation',definition(10),emptyLocations).novel,true);
 assert.equal(guard('code_navigation',definition(10),emptyLocations).novel,false);
 assert.equal(guard('code_navigation',definition(20),emptyLocations).novel,true);
 const found=JSON.stringify({path:'src/a.ts',hash:'same',language:'typescript',locations:[{path:'src/def.ts',range:{start:{line:4,character:0},end:{line:4,character:3}}}]});
 assert.equal(guard('code_navigation',definition(10),found).novel,true);
 assert.equal(guard('code_navigation',definition(11),found).novel,false);
});

test('changes to trailing whitespace in a numbered source line remain observable',()=>{
 const guard=createResearchProgressGuard();
 assert.equal(observe(guard,read('src/code.py',1,1,[[1,'value = 1']])).novel,true);
 assert.equal(observe(guard,read('src/code.py',1,1,[[1,'value = 1  ']])).novel,true);
});
