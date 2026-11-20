import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Classes{constructor(){this.values=new Set()}add(...names){names.forEach(x=>this.values.add(x))}remove(...names){names.forEach(x=>this.values.delete(x))}toggle(name,force){const set=force===undefined?!this.values.has(name):force;if(set)this.values.add(name);else this.values.delete(name);return set}contains(name){return this.values.has(name)}}
class Element{constructor(){this.dataset={};this.classList=new Classes();this.children=[];this.attributes={};this.value='';this.textContent='';this.disabled=false;this.open=false;this.scrollHeight=0}setAttribute(name,value){this.attributes[name]=value}hasAttribute(name){return Object.hasOwn(this.attributes,name)}append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=[...nodes]}addEventListener(){}remove(){}close(){this.open=false}showModal(){this.open=true}focus(){}removeAttribute(name){delete this.attributes[name]}}
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,val)=>map.set(key,String(val)),removeItem:key=>map.delete(key)}};
async function uiHarness(){
 const nodes=new Map(),languages=['ru','en'].map(language=>{const el=new Element();el.dataset.language=language;return el});
 const element=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector)};
 const document={documentElement:new Element(),querySelector:s=>s==='meta[name="diabolix-token"]'?{content:'test-token'}:element(s),querySelectorAll:s=>s==='[data-language]'?languages:[],createElement:()=>new Element(),createDocumentFragment:()=>new Element(),addEventListener(){}};
 const sources=[];class EventSource{static CLOSED=2;constructor(url){this.url=url;this.readyState=1;sources.push(this)}emit(event){this.onmessage?.({data:JSON.stringify(event)})}close(){this.readyState=2}}
 const requests=[];let steerHandler=async()=>({ok:true});
 const fetch=async(url,options={})=>{let payload;try{payload=options.body&&JSON.parse(options.body)}catch{}requests.push({url,payload});let result;if(url==='/api/config')result={model:'unit-model',workspace:'/project',profile:'coding'};else if(url==='/api/run')result={id:'task-1'};else if(url==='/api/steer')result=await steerHandler(payload);else throw Error('Unexpected route '+url);return {ok:true,json:async()=>result}};
 const formatTelemetry=()=>({prompt:'0',cached:'0',completion:'0',latency:'0 s',cost:'—',steps:0});
 const context=vm.createContext({document,fetch,EventSource,crypto,localStorage:memory(),sessionStorage:memory(),formatTelemetry,console,setTimeout,clearTimeout,setInterval,clearInterval});
 const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import \{formatTelemetry\} from '\.\/telemetry\.js';\s*/, '');
 vm.runInContext(source+'\nglobalThis.__ui={send,watchRun};',context,{filename:'public/app.js'});await new Promise(resolve=>setImmediate(resolve));
 return {nodes,element,languages,sources,requests,ui:context.__ui,setSteer:handler=>{steerHandler=handler}};
}

test('composer accepts queued steering while busy, displays status events, and returns to task mode after finish',async()=>{
 const h=await uiHarness();h.languages[1].onclick();await h.ui.send('Build a page');assert.equal(h.sources.length,1);const source=h.sources[0],button=h.element('#send'),prompt=h.element('#prompt');assert.equal(button.classList.contains('hidden'),false);assert.equal(button.attributes['aria-label'],'Send clarification');assert.match(prompt.placeholder,/Clarify/);
 prompt.value='Use the existing API';let captured;h.setSteer(async payload=>{captured=payload;source.emit({type:'steering_queued',text:payload.message,requestId:payload.requestId});return {queued:true}});await h.ui.send(prompt.value);assert.equal(captured.id,'task-1');assert.equal(captured.message,'Use the existing API');assert.match(captured.requestId,/^[a-f0-9-]{36}$/);assert.equal(prompt.value,'');
 const feed=h.element('#feed');assert.ok(feed.children.some(node=>node.children[1]?.textContent==='Use the existing API'));assert.ok(feed.children.some(node=>node.children[1]?.textContent.includes('Clarification queued')));source.emit({type:'steering_applied',requestId:captured.requestId});assert.ok(feed.children.some(node=>node.children[1]?.textContent.includes('next model request')));source.emit({type:'steering_undelivered',requestId:captured.requestId});assert.ok(feed.children.some(node=>node.children[1]?.textContent.includes('ended before')));
 source.emit({type:'finished'});assert.equal(button.attributes['aria-label'],'Send');assert.match(prompt.placeholder,/Describe/);assert.equal(button.classList.contains('hidden'),false);
});
test('a lost steering response retains draft and reuses request ID without duplicating the queued event',async()=>{
 const h=await uiHarness();await h.ui.send('Work on the project');const source=h.sources[0],prompt=h.element('#prompt');prompt.value='Preserve the public API';const ids=[];let attempt=0;h.setSteer(async payload=>{ids.push(payload.requestId);if(attempt++===0){source.emit({type:'steering_queued',text:payload.message,requestId:payload.requestId});throw Error('Network response lost')}return {queued:true,duplicate:true}});await h.ui.send(prompt.value);assert.equal(prompt.value,'Preserve the public API');await h.ui.send(prompt.value);assert.equal(ids[0],ids[1]);assert.equal(prompt.value,'');assert.equal(h.element('#feed').children.filter(node=>node.children[1]?.textContent==='Preserve the public API').length,1);
});
