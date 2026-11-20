import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile,realpath} from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {TaskJournal} from '../task-journal.js';

const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server.address().port};
test('project memory paginates all retained entries and can forget one beyond the first hundred', {timeout:30000},async t=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'diabolix-memory-pages-'))),workspace=path.join(root,'workspace');await mkdir(workspace);
 const journal=new TaskJournal(path.join(root,'.diabolix-sessions'));await journal.init();const id=crypto.randomUUID();
 await journal.append(id,{kind:'start',journal_version:1,task:'Prepare decisions',workspace,profile:'coding'});
 for(let i=1;i<=130;i++)await journal.append(id,{kind:'event',event:{id:i,type:'architecture_decision',text:`Authentication decision ${i}`}});
 await journal.append(id,{kind:'event',event:{id:131,type:'done'}});await journal.append(id,{kind:'event',event:{id:132,type:'finished'}});await journal.flush();
 const original=await readFile(journal.file(id),'utf8'),reservation=http.createServer(),port=await listen(reservation);await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DIABOLIX_CONFIG_PATH:path.join(root,'config.local.json')}});t.after(async()=>{child.kill();await rm(root,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exited '+code)))});
 const base='http://127.0.0.1:'+port,html=await(await fetch(base)).text(),token=html.match(/name="diabolix-token" content="([^"]+)/)?.[1];assert.ok(token);const headers={'Content-Type':'application/json','X-Diabolix-Token':token};
 async function get(route){const response=await fetch(base+'/api/'+route,{headers});return {status:response.status,body:await response.json()}}
 async function post(route,body){const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(body)});assert.ok(response.ok);return response.json()}
 await post('config',{workspace,model:'test',endpoint:'http://127.0.0.1:3001/v1',mcpUrl:''});
 let page=await get('project-memory');assert.equal(page.status,200);assert.equal(page.body.total,130);assert.equal(page.body.items.length,25);assert.equal(page.body.next_offset,25);assert.equal(page.body.partial,false);
 const ids=new Set();for(let offset=0;offset<130;offset+=25){page=await get(`project-memory?offset=${offset}&limit=25`);assert.equal(page.body.offset,offset);for(const item of page.body.items)ids.add(item.source.event_id)}assert.equal(ids.size,130);assert.equal(page.body.next_offset,null);
 const old=page.body.items.at(-1);assert.ok(old);assert.ok(!old.excluded);await post('project-memory',{action:'forget',...old.source});page=await get('project-memory?offset=125&limit=25');assert.equal(page.body.items.find(item=>item.source.event_id===old.source.event_id).excluded,true);assert.equal(await readFile(journal.file(id),'utf8'),original);
 for(const query of ['offset=-1','offset=1.5','offset=1001','limit=0','limit=101','limit=Infinity'])assert.equal((await get('project-memory?'+query)).status,400,query);
});
