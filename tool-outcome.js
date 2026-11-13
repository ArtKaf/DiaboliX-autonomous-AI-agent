import crypto from 'node:crypto';
// Capture execution evidence separately from model-generated summaries.
export function toolOutcome(name,args,result,{threw=false}={}){
 const text=String(result??'');let status='unknown',exitCode=null;
 const matches=[...text.matchAll(/(?:^|\n)\[код: ([^\]]+)\]/g)],marker=matches[0]?.[1];
 if(/file may have changed|write verification failed/i.test(text))status='unknown';
 else if(threw||/^Ошибка:/.test(text))status='error';
 else if(marker!==undefined){const n=Number(marker);exitCode=Number.isInteger(n)?n:null;status=/тайм-аут/i.test(marker)?'timeout':exitCode===0?'success':'error'}
 else {try{const value=JSON.parse(text);if(value&&Array.isArray(value.content))status=value.isError?'error':'success';else if(name==='browser_test'&&typeof value?.ok==='boolean')status=value.ok?'success':'error';else if(name==='read_task_evidence'&&value&&typeof value==='object'||name==='project_state'&&value&&Array.isArray(value.files)&&typeof value.tree==='string'||name==='verify_task'&&value&&Array.isArray(value.changed_files)&&typeof value.tree==='string')status='success'}catch{}if(name==='read_file'&&text.includes('не менялся с прошлого чтения'))status='cached';}
 const diagnostic=matches.length>1?matches.at(-1)[1]:null,diagnosticText=text.includes('Post-edit diagnostics:')?text.slice(text.lastIndexOf('Post-edit diagnostics:')):'',diagnosticStatus=diagnostic===null?null:!/^0$/.test(diagnostic)?'failed':/(?:пропущен|недоступна|skipped|not available)/i.test(diagnosticText)?'skipped':'passed';let verifiedHash,verifiedHashes;
 if(status==='success'&&text.includes('Write verification: file contents match')){if(name==='write_file'&&typeof args?.content==='string')verifiedHash=crypto.createHash('sha256').update(args.content).digest('hex');else if(['patch_file','smart_edit'].includes(name)){try{const candidate=JSON.parse(text.split('\n')[0]).hash;if(/^[a-f0-9]{64}$/.test(candidate))verifiedHash=candidate}catch{}}}
 if(status==='success'&&name==='smart_edit_batch'&&args?.preview!==true){try{const applied=JSON.parse(text.split('\n')[0]).applied;if(Array.isArray(applied)&&applied.length>0&&applied.length<=10&&applied.every(x=>typeof x.path==='string'&&/^[a-f0-9]{64}$/.test(x.hash)))verifiedHashes=applied.map(x=>({path:x.path,hash:x.hash}))}catch{}}
 return {tool:name,status,...(exitCode!==null?{exit_code:exitCode}:{}),...(diagnosticStatus!==null?{diagnostics:diagnosticStatus}:{}),...(verifiedHash?{verified_hash:verifiedHash}:{}),...(verifiedHashes?{verified_hashes:verifiedHashes}:{}),...(typeof args?.path==='string'?{path:args.path.slice(0,500)}:{})};
}
export function formatEvidence(items,limit=30){
 if(!items.length)return '';const visible=items.slice(-limit);return 'Verified tool execution statuses (not proof that the entire task is complete; older items may be omitted):\n'+visible.map(x=>JSON.stringify(x)).join('\n');
}
export function readTaskEvidence(events,eventId){
 const results=events.filter(e=>['tool_result','research_observation','review_observation','recon_observation'].includes(e.type)&&e.name!=='read_task_evidence');
 if(eventId===undefined)return {events:results.slice(-30).map(e=>({event_id:e.id,name:e.name,role:e.type==='research_observation'?'researcher':e.type==='review_observation'?'reviewer':e.type==='recon_observation'?'harness':'worker',outcome:e.outcome||{status:'unknown'},memory_source:e.memory_source||{scope:'unknown'}})),notice:'Only the latest 30 results are listed. Supply event_id to read one result.'};
 if(!Number.isSafeInteger(eventId)||eventId<1)throw Error('Укажите корректный event_id.');const event=results.find(e=>e.id===eventId);if(!event)throw Error('Результат инструмента с таким event_id не найден.');const text=String(event.text||'');return {event_id:event.id,name:event.name,role:event.type==='research_observation'?'researcher':event.type==='review_observation'?'reviewer':event.type==='recon_observation'?'harness':'worker',outcome:event.outcome||{status:'unknown'},memory_source:event.memory_source||{scope:'unknown'},text:text.slice(0,12000),truncated:!!event.truncated||text.length>12000||text.includes('…[вывод сокращён]')};
}
