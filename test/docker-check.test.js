import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {checkDocker} from '../sandbox.js';

const command=script=>({timeoutMs:500,spawnCommand:(_name,_args,options)=>spawn(process.execPath,['-e',script],options)});

test('Docker preflight verifies that the daemon responds',async()=>{
 await checkDocker(new AbortController().signal,command("console.log('29.0')"));
 await assert.rejects(checkDocker(new AbortController().signal,command("console.error('daemon offline');process.exit(1)")),/Docker недоступен.*daemon offline/);
});

test('Docker preflight reports timeouts and respects cancellation',async()=>{
 const hanging=command('setInterval(()=>{},1000)');hanging.timeoutMs=150;
 await assert.rejects(checkDocker(new AbortController().signal,hanging),/Docker не ответил.*песочница не запущена/);
 const controller=new AbortController();const running=checkDocker(controller.signal,command('setInterval(()=>{},1000)'));controller.abort();await assert.rejects(running,/Остановлено/);
});
