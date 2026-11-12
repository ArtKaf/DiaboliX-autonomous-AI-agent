import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validEffort,resolveEffort,ReasoningHistory} from '../reasoning.js';

test('reasoning levels validate and role overrides inherit or use provider default',()=>{
 for(const level of ['', 'none','minimal','low','medium','high','xhigh','max'])assert.equal(validEffort(level),true);
 assert.equal(validEffort('default'),false);assert.equal(validEffort('default',true),true);assert.equal(validEffort('ultra'),false);assert.equal(validEffort(null),false);
 const config={reasoningEffort:'high',plannerReasoningEffort:'low',workerReasoningEffort:'',reviewerReasoningEffort:'default'};
 assert.equal(resolveEffort(config,'planner'),'low');assert.equal(resolveEffort(config,'worker'),'high');assert.equal(resolveEffort(config,'reviewer'),'');
});
test('provider reasoning state stays with the originating endpoint and model',()=>{
 const history=new ReasoningHistory(),details=[{type:'reasoning.encrypted',data:'opaque'}];
 const turn=history.record({content:null,tool_calls:[{id:'1'}],reasoning_content:'private state',reasoning_details:details},'https://a.test','model-a');
 assert.equal(history.forModel([turn],'https://a.test','model-a')[0].reasoning_content,'private state');
 assert.deepEqual(history.forModel([turn],'https://a.test','model-a')[0].reasoning_details,details);
 for(const [endpoint,model] of [['https://a.test','model-b'],['https://b.test','model-a']]){const cleaned=history.forModel([turn],endpoint,model)[0];assert.equal(cleaned.reasoning_content,undefined);assert.equal(cleaned.reasoning_details,undefined);assert.deepEqual(cleaned.tool_calls,[{id:'1'}]);}
});
