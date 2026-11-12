import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import {sandboxTool} from '../sandbox.js';
import {withPackageNetwork} from '../package-network.js';

const {createProxy,isPublic}=createRequire(import.meta.url)('../sandbox/install-proxy.cjs');
const exec=promisify(execFile);
const secret='a'.repeat(64);
const auth='Basic '+Buffer.from('diabolix:'+secret).toString('base64');
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port}
function connect(port,target,authorization=auth){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method:'CONNECT',path:target,headers:{'Proxy-Authorization':authorization}});req.on('connect',(res,socket)=>{socket.destroy();resolve(res.statusCode)});req.on('error',reject);req.end()})}

test('package proxy restricts targets, credentials and DNS rebinding',async t=>{
 assert.equal(isPublic('8.8.8.8'),true);for(const ip of ['127.0.0.1','192.168.0.1','10.1.2.3','169.254.169.254','::1'])assert.equal(isPublic(ip),false);
 const upstream=net.createServer(socket=>socket.end());const upstreamPort=await listen(upstream);t.after(()=>upstream.close());
 let dnsAnswers=[{address:'8.8.8.8',family:4}];
 const proxy=createProxy(secret,{lookup:async()=>dnsAnswers,connect:()=>net.connect(upstreamPort,'127.0.0.1')});const port=await listen(proxy);t.after(()=>proxy.close());
 assert.equal(await connect(port,'pypi.org:443'),200);
 assert.equal(await connect(port,'example.com:443'),403);
 assert.equal(await connect(port,'pypi.org:80'),403);
 assert.equal(await connect(port,'pypi.org:443','Basic bad'),403);
 dnsAnswers=[{address:'8.8.8.8',family:4},{address:'192.168.1.1',family:4}];assert.equal(await connect(port,'pypi.org:443'),403);
});

test('downloads and reuses npm and Python dependencies in isolated containers',{skip:process.env.DIABOLIX_TEST_PACKAGE_DOWNLOADS!=='1',timeout:600000},async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diabolix-packages-'));await chmod(dir,0o777);t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(path.join(dir,'package.json'),JSON.stringify({name:'diabolix-package-test',version:'1.0.0',scripts:{postinstall:'node -e "require(\u0027fs\u0027).writeFileSync(\u0027installed-script\u0027,\u0027yes\u0027)"'}}),{mode:0o666});
 const signal=new AbortController().signal;const call=(name,args)=>sandboxTool(name,{...args,timeout_ms:300000},dir,signal);
 const pip=await call('install_dependencies',{manager:'pip',packages:['numpy']});assert.match(pip,/\[код: 0\]/,pip);
 const python=await call('run_command',{command:'python -c "import numpy; print(numpy.__version__)"'});assert.match(python,/\[код: 0\]/,python);
 const npm=await call('install_dependencies',{manager:'npm',packages:['is-number']});assert.match(npm,/\[код: 0\]/,npm);
 const node=await call('run_command',{command:'node -e "console.log(require(\u0027is-number\u0027)(\u002712\u0027))"'});assert.match(node,/true/);assert.match(node,/\[код: 0\]/);
 await assert.rejects(readFile(path.join(dir,'installed-script')),{code:'ENOENT'});
 const scripts=await call('install_dependencies',{manager:'npm',allow_scripts:true});assert.match(scripts,/\[код: 0\]/,scripts);assert.equal(await readFile(path.join(dir,'installed-script'),'utf8'),'yes');
});

test('installer network blocks direct internet and host access and cleans up on failure',{skip:process.env.DIABOLIX_TEST_PACKAGE_DOWNLOADS!=='1',timeout:120000},async t=>{
 const host=net.createServer(socket=>socket.end());await new Promise(resolve=>host.listen(0,'0.0.0.0',resolve));t.after(()=>host.close());
 let network;await assert.rejects(withPackageNetwork(process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local',new AbortController().signal,async session=>{
  network=session.network;
  const script=`const n=require('node:net');async function check(host,port){return new Promise(resolve=>{let s=n.connect(port,host);s.setTimeout(1500);s.on('connect',()=>{s.destroy();resolve(true)});s.on('error',()=>resolve(false));s.on('timeout',()=>{s.destroy();resolve(false)})})}(async()=>process.exit((await check('1.1.1.1',443))||(await check('host.docker.internal',${host.address().port}))?1:0))();`;
  await exec('docker',['run','--rm','--network',network,'--dns','127.0.0.1','--entrypoint','node',process.env.DIABOLIX_SANDBOX_IMAGE||'diabolix-sandbox:local','-e',script]);
  throw Error('cleanup check');
 }),/cleanup check/);
 await assert.rejects(exec('docker',['network','inspect',network]));
});
