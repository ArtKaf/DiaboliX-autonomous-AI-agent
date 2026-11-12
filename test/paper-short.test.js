import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PaperExchangeClient} from '../mcp/paper-exchange.js';
import {OrderJournal} from '../mcp/order-journal.js';

function setup(journal){
 const state={version:1,account:{balances:{USDT:1000,BTC:0,ETH:0,SOL:0},orders:[],positions:[]}},market={price:100,bids:[[99,10]],asks:[[101,10]],bookSource:'live',tradeSource:'live'};let posts=0,lose=false,actual='live';
 const fetcher=async(url,options)=>{
  if(url.endsWith('/api/market'))return Response.json({status:market.bookSource,timestamp:1000,markets:{BTCUSDT:market}});
  if(url.endsWith('/api/account'))return Response.json(structuredClone(state));
  const input=JSON.parse(options.body);posts++;let position,order;
  if(url.endsWith('/api/short/open')){position={id:'short-'+posts,asset:input.asset,side:'SHORT',status:'open',quantity:input.quantity,source:actual};state.account.positions.unshift(position);state.account.balances.USDT-=input.quantity*99*1.001;order={id:'order-'+posts,positionId:position.id,asset:input.asset,side:'sell',type:'short_open',status:'filled',quantity:input.quantity,source:actual};}
  else if(url.endsWith('/api/short/close')){position=state.account.positions.find(p=>p.id===input.id);Object.assign(position,{status:'closed',closeSource:actual,realizedPnl:-2});order={id:'order-'+posts,positionId:position.id,asset:position.asset,side:'buy',type:'short_close',status:'filled',quantity:position.quantity,source:actual};}
  else throw Error('Unexpected route');state.account.orders.unshift(order);state.version++;if(lose){lose=false;throw Error('response lost')}return Response.json(structuredClone(state));
 };
 return {client:new PaperExchangeClient({fetcher,now:()=>1000,journal}),fetcher,state,posts:()=>posts,lose:()=>lose=true,fallback:()=>{market.bookSource=market.tradeSource='fallback'},actualFallback:()=>actual='fallback'};
}
const open={asset:'BTC',quantity:1,request_id:'short_open_123456'};
test('open and close shorts expose positions and are idempotent',async()=>{
 const {client,posts}=setup();const opened=await client.shortOpen(open);assert.equal(opened.position.status,'open');assert.match(opened.notice,/No short stop-loss/);assert.equal((await client.account()).short_positions[0].id,opened.position.id);
 assert.equal((await client.shortOpen(open)).position_id,opened.position.id);await assert.rejects(client.shortOpen({...open,quantity:2}),/different arguments/);
 const close={position_id:opened.position.id,request_id:'short_close_123456'};const closed=await client.shortClose(close);assert.equal(closed.position.status,'closed');assert.equal((await client.shortClose(close)).duplicate,true);const account=await client.account();assert.equal(account.short_positions.length,0);assert.equal(account.recent_short_positions[0].id,opened.position.id);assert.equal(posts(),2);
});
test('short preflight checks balance, position, and synthetic pricing',async()=>{
 const env=setup();env.state.account.balances.USDT=100;await assert.rejects(env.client.shortOpen({...open,quantity:2}),/Insufficient virtual USDT/);await assert.rejects(env.client.shortClose({position_id:'missing',request_id:'short_close_123456'}),/not found/);env.fallback();await assert.rejects(env.client.shortOpen(open),/explicit user permission/);assert.equal(env.posts(),0);
});
test('lost short response is persisted and prevents repeating after restart',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'diab-short-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'journal.json'),journal=new OrderJournal(file);await journal.prepare();const env=setup(journal);env.lose();await assert.rejects(env.client.shortOpen(open),/outcome is unknown/);assert.equal(env.posts(),1);
 const restarted=new OrderJournal(file);await restarted.prepare();const client=new PaperExchangeClient({fetcher:env.fetcher,now:()=>1000,journal:restarted});assert.equal((await client.account()).unresolved_shorts[0].kind,'short_open');await assert.rejects(client.shortOpen(open),/unconfirmed or unresolved/);await assert.rejects(client.shortOpen({...open,request_id:'different_short_123'}),/unconfirmed or unresolved/);assert.equal(env.posts(),1);await client.acknowledge({request_id:open.request_id});assert.equal((await client.account()).unresolved_shorts.length,0);
});
test('unexpected synthetic execution is marked for manual review',async()=>{
 const env=setup();env.actualFallback();const result=await env.client.shortOpen(open);assert.equal(result.requires_manual_review,true);assert.match(result.warnings[0],/synthetic/);assert.equal((await env.client.account()).unresolved_shorts[0].position_id,result.position.id);await assert.rejects(env.client.shortOpen({...open,request_id:'different_short_123'}),/unresolved/);
});
test('lost short close response cannot be retried with a different request ID',async()=>{
 const env=setup();const opened=await env.client.shortOpen(open);const close={position_id:opened.position.id,request_id:'short_close_123456'};env.lose();await assert.rejects(env.client.shortClose(close),/outcome is unknown/);await assert.rejects(env.client.shortClose({...close,request_id:'different_close_123'}),/unconfirmed or unresolved/);assert.equal((await env.client.account()).unresolved_shorts[0].position_id,opened.position.id);assert.equal(env.posts(),2);
});
