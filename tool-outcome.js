import crypto from 'node:crypto';
// Capture execution evidence separately from model-generated summaries.
export function toolOutcome(name,args,result,{threw=false}={}){
 const text=String(result??'');let status='unknown',exitCode=null;
 const matches=[...text.matchAll(/\[код: ([^\]]+)\]/g)],marker=matches[0]?.[1];
 if(/file may have changed|write verification failed/i.test(text))status='unknown';
 else if(threw||/^Ошибка:/.test(text))status='error';
 else if(marker!==undefined){const n=Number(marker);exitCode=Number.isInteger(n)?n:null;status=/тайм-аут/i.test(marker)?'timeout':exitCode===0?'success':'error'}
 else {try{const value=JSON.parse(text);if(value&&Array.isArray(value.content))status=value.isError?'error':'success';else if(name==='read_task_evidence'&&value&&typeof value==='object')status='success'}catch{}if(name==='read_file'&&text.includes('не менялся с прошлого чтения'))status='cached';}
 const diagnostic=matches.length>1?matches.at(-1)[1]:null;let verifiedHash;if(status==='success'&&text.includes('Write verification: file contents match')){if(name==='write_file'&&typeof args?.content==='string')verifiedHash=crypto.createHash('sha256').update(args.content).digest('hex');else if(name==='patch_file'){try{const first=text.split('\n')[0];const candidate=JSON.parse(first).hash;if(/^[a-f0-9]{64}$/.test(candidate))verifiedHash=candidate}catch{}}}const outcome={tool:name,status,...(exitCode!==null?{exit_code:exitCode}:{}),...(diagnostic!==null?{diagnostics:/^0$/.test(diagnostic)?'passed':'failed'}:{}),...(verifiedHash?{verified_hash:verifiedHash}:{}),...(typeof args?.path==='string'?{path:args.path.slice(0,500)}:{})};return outcome;
}
export function formatEvidence(items,limit=30){
 if(!items.length)return '';const visible=items.slice(-limit);return 'Verified tool execution statuses (not proof that the entire task is complete; older items may be omitted):\n'+visible.map(x=>JSON.stringify(x)).join('\n');
}
export function readTaskEvidence(events,eventId){
 const results=events.filter(e=>e.type==='tool_result'&&e.name!=='read_task_evidence');
 if(eventId===undefined)return {events:results.slice(-30).map(e=>({event_id:e.id,name:e.name,outcome:e.outcome||{status:'unknown'}})),notice:'Only the latest 30 results are listed. Supply event_id to read one result.'};
 if(!Number.isSafeInteger(eventId)||eventId<1)throw Error('Укажите корректный event_id.');const event=results.find(e=>e.id===eventId);if(!event)throw Error('Результат инструмента с таким event_id не найден.');const text=String(event.text||'');return {event_id:event.id,name:event.name,outcome:event.outcome||{status:'unknown'},text:text.slice(0,12000),truncated:text.length>12000};
}
