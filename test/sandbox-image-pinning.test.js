import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveSandboxImage,sandboxTool} from '../sandbox.js';

const id='sha256:'+'a'.repeat(64);
function fakeInspect(script,options={}){
 return {timeoutMs:1000,...options,spawnCommand:(name,args,stdio)=>{
  assert.equal(name,'docker');assert.deepEqual(args.slice(0,4),['image','inspect','--format','{{.Id}}']);
  return spawn(process.execPath,['-e',script],stdio);
 }};
}

test('resolves exactly one immutable sandbox image ID and rejects malformed inspection results',async()=>{
 const signal=new AbortController().signal;
 assert.equal(await resolveSandboxImage(signal,fakeInspect(`console.log('${id}')`)),id);
 for(const value of ['node:22-bookworm','sha256:'+'a'.repeat(63),'sha256:'+'A'.repeat(64),id+'\n'+id,'']){
  await assert.rejects(resolveSandboxImage(signal,fakeInspect(`console.log(${JSON.stringify(value)})`)),/не вернул корректный/);
 }
 await assert.rejects(resolveSandboxImage(signal,fakeInspect("console.error('image missing');process.exit(1)")),/не удалось проверить образ Docker.*image missing/i);
 await assert.rejects(resolveSandboxImage(signal,fakeInspect("console.log('x'.repeat(2000))")),/некорректный ответ/i);
});

test('image inspection supports cancellation and a bounded timeout',async()=>{
 const signal=new AbortController().signal;
 await assert.rejects(resolveSandboxImage(signal,fakeInspect('setInterval(()=>{},1000)',{timeoutMs:120})),/тайм|превысила/i);
 const controller=new AbortController(),running=resolveSandboxImage(controller.signal,fakeInspect('setInterval(()=>{},1000)'));controller.abort();await assert.rejects(running,/Остановлено/);
 const stopped=new AbortController();stopped.abort();await assert.rejects(resolveSandboxImage(stopped.signal,fakeInspect('throw Error("must not run")')),/Остановлено/);
});

test('ordinary and dependency-install containers use the supplied immutable image ID',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-image-pin-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const docker=path.join(dir,'docker'),trace=path.join(dir,'trace');
 await writeFile(docker,`#!/bin/sh
printf '%s\\n' --BEGIN-- "$@" --END-- >> "$DIABOLIX_IMAGE_TEST_TRACE"
case "$1:$2" in
 network:create) exit 0 ;;
 network:inspect) printf '%s\\n' '{"Internal":true,"Options":{"com.docker.network.bridge.gateway_mode_ipv4":"isolated"}}'; exit 0 ;;
 network:connect|network:rm|rm:-f) exit 0 ;;
 run:-d) printf '%s\\n' proxy; exit 0 ;;
 inspect:diabolix-registry-*) suffix=\${2#diabolix-registry-}; printf '{"diabolix-packages-%s":{"IPAddress":"172.20.0.2"}}\\n' "$suffix"; exit 0 ;;
 run:*) cat >/dev/null; printf '%s\\n' 'tool output'; exit 0 ;;
 *) exit 2 ;;
esac
`);await chmod(docker,0o755);
 const previousPath=process.env.PATH,previousTrace=process.env.DIABOLIX_IMAGE_TEST_TRACE;process.env.PATH=dir+path.delimiter+previousPath;process.env.DIABOLIX_IMAGE_TEST_TRACE=trace;
 t.after(()=>{process.env.PATH=previousPath;if(previousTrace===undefined)delete process.env.DIABOLIX_IMAGE_TEST_TRACE;else process.env.DIABOLIX_IMAGE_TEST_TRACE=previousTrace});
 const signal=new AbortController().signal;
 const output=await sandboxTool('run_command',{command:'echo example'},dir,signal,24000,{imageId:id});assert.match(output,/\[код: 0\]/);
 const install=await sandboxTool('install_dependencies',{manager:'npm',packages:['sample']},dir,signal,24000,{imageId:id});assert.match(install,/\[код: 0\]/);
 const groups=(await readFile(trace,'utf8')).split('--BEGIN--\n').slice(1).map(part=>part.split('--END--\n')[0].trim().split('\n'));
 const ordinary=groups.find(a=>a[0]==='run'&&a[1]!=='-d'),proxy=groups.find(a=>a[0]==='run'&&a[1]==='-d'),installer=groups.filter(a=>a[0]==='run'&&a[1]!=='-d')[1];
 assert.ok(ordinary?.at(-1)===id,'ordinary sandbox was not pinned');assert.ok(installer?.at(-1)===id,'installer sandbox was not pinned');assert.ok(proxy?.includes(id),'installer proxy was not pinned');for(const run of [ordinary,installer])assert.deepEqual(run.slice(1,3),['--pull','never']);
 await assert.rejects(sandboxTool('run_command',{command:'true'},dir,signal,24000,{imageId:'node:22-bookworm'}),/неизменяемый ID/);
 const before=groups.length;const fallback=await sandboxTool('run_command',{command:'true'},dir,signal);assert.match(fallback,/\[код: 0\]/);const after=(await readFile(trace,'utf8')).split('--BEGIN--\n').slice(1);assert.equal(after.length,before+1);assert.ok(after.at(-1).includes(process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local'));
});
