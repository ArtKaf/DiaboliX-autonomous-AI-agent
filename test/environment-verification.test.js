import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildVerification} from '../verification.js';

const tree='a'.repeat(40),other='b'.repeat(40),state={tree,files:[],has_more:false};
const environment=status=>({scope:'partial',status,limitations:['selected manifests only']});
function run({testEnv,diagnosisEnv,changedDuringTest=false,testTree=tree,diagnosisTree=tree}={}){
 return buildVerification({state,tests:{tree:testTree,status:'success',command:'node --test',changed_during_test:changedDuringTest,environment:environment(testEnv)},diagnosis:{tree:diagnosisTree,status:'completed',checked:[{path:'app.js'}],problems:[],truncated:false,environment:environment(diagnosisEnv)},postEdit:[],events:[],computer:[]});
}

test('environment freshness is partial and unknown or changed cannot become a current test/diagnosis',()=>{
 for(const status of ['unknown','changed']){const result=run({testEnv:status,diagnosisEnv:status});assert.equal(result.tests.fresh,false);assert.equal(result.project_diagnostics.fresh,false);assert.equal(result.tests.environment.scope,'partial');assert.match(result.limitations.join(' '),/installed dependencies/i);}
 const result=run({testEnv:'unchanged',diagnosisEnv:'unchanged'});assert.equal(result.tests.fresh,true);assert.equal(result.project_diagnostics.fresh,true);assert.equal(result.tests.environment.scope,'partial');
});

test('matching partial environment does not override changed files or mutations during tests',()=>{
 assert.equal(run({testEnv:'unchanged',diagnosisEnv:'unchanged',changedDuringTest:true}).tests.fresh,false);
 const result=run({testEnv:'unchanged',diagnosisEnv:'unchanged',testTree:other,diagnosisTree:other});assert.equal(result.tests.fresh,false);assert.equal(result.project_diagnostics.fresh,false);
});
