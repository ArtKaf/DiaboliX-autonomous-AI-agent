import {test} from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {toolOutcome,formatEvidence,readTaskEvidence} from '../tool-outcome.js';
test('tool evidence distinguishes command status from diagnostics and unknown writes',()=>{
 assert.deepEqual(toolOutcome('patch_file',{path:'a.js'},'patched\n[код: 0]\nPost-edit diagnostics:\nSyntaxError\n[код: 1]'),{tool:'patch_file',status:'success',exit_code:0,diagnostics:'failed',path:'a.js'});
 assert.equal(toolOutcome('write_file',{},'Ошибка: The file may have changed, but write verification failed',{threw:true}).status,'unknown');
 assert.equal(toolOutcome('run_command',{},'\n[код: нет, тайм-аут]').status,'timeout');assert.equal(toolOutcome('run_command',{},'\n[код: 1]').status,'error');
 assert.equal(toolOutcome('mcp_1',{},JSON.stringify({isError:true,content:[]})).status,'error');assert.equal(toolOutcome('mcp_1',{},'no structured result').status,'unknown');
 assert.match(formatEvidence([{tool:'write_file',status:'success',path:'a.js'}]),/not proof/);
 const verified=toolOutcome('write_file',{path:'a.js',content:'new'},'Written\n[код: 0]\nWrite verification: file contents match the intended result.');assert.equal(verified.verified_hash,crypto.createHash('sha256').update('new').digest('hex'));assert.equal(toolOutcome('write_file',{content:'new'},'Written\n[код: 0]').verified_hash,undefined);
});
test('compacted tool observations can be retrieved by their event ID',()=>{const events=[{id:1,type:'tool_result',name:'read_file',text:'original content',outcome:{status:'success'}},{id:2,type:'tool_result',name:'read_task_evidence',text:'meta'}];assert.equal(readTaskEvidence(events).events.length,1);assert.equal(readTaskEvidence(events,1).text,'original content');assert.throws(()=>readTaskEvidence(events,2),/не найден/)});
