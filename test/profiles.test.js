import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {toolsForProfile} from '../profiles.js';
import {loadConfig,saveConfig} from '../config-store.js';

test('coding filters trading tools from a mixed MCP server while preserving web tools',()=>{
 const tools=['web_search','read_web_page','computer','exchange_order','exchange_market','exchange_short_open','exchange_short_close','paper_exchange_account','trade_order','broker_positions','place_order','get_orderbook','order_history','EXCHANGE_QUOTES','finance_quote','get_ticker'].map(name=>({name}));
 assert.deepEqual(toolsForProfile(tools,'coding').map(t=>t.name),['web_search','read_web_page','computer']);assert.deepEqual(toolsForProfile(tools,'trading'),tools);
});
test('profile defaults to coding and persists safely across restarts',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');const defaults={workspace:dir};assert.equal((await loadConfig(file,defaults)).profile,'coding');await saveConfig(file,{...defaults,profile:'trading'});assert.equal(JSON.parse(await readFile(file,'utf8')).profile,'trading');assert.equal((await loadConfig(file,defaults)).profile,'trading');await writeFile(file,JSON.stringify({profile:'unexpected'}));assert.equal((await loadConfig(file,defaults)).profile,'coding');
});
test('optional MCP read-only filter relies only on declared annotations',async()=>{const {toolsForAccess}=await import('../profiles.js');const input=[{name:'read',annotations:{readOnlyHint:true}},{name:'write',annotations:{readOnlyHint:false}},{name:'unknown'}];assert.deepEqual(toolsForAccess(input,false),input);assert.deepEqual(toolsForAccess(input,true).map(x=>x.name),['read'])});
