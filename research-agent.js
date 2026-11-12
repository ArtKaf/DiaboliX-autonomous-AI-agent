// A bounded, read-only specialist. It reports observations, not verified facts.
export async function researchProject({task,map,rules,ask,read,tools,signal,maxCalls=4}){
 const messages=[{role:'system',content:'You are a read-only repository research specialist. Inspect only files relevant to the user task. Never modify files or run commands. Return a concise report with paths and concrete observations; state uncertainty.'},{role:'user',content:JSON.stringify({task,map,rules})}];let remaining=maxCalls;
 for(let turn=0;turn<=maxCalls;turn++){
  if(signal?.aborted)throw Error('Остановлено');const response=await ask(messages,{tools,tool_choice:remaining?'auto':'none'});const calls=response.tool_calls||[];messages.push({role:'assistant',content:response.content??null,...(calls.length?{tool_calls:calls}:{})});
  if(!calls.length)return String(response.content||'No research conclusion was provided.').slice(0,5000);
  for(const call of calls){let result;try{if(remaining<=0)throw Error('Read-only tool budget exhausted.');remaining--;const name=call.function?.name;if(!['list_files','read_file','search_code','parse_ast'].includes(name))throw Error('Only read-only research tools are allowed.');let args;try{args=JSON.parse(call.function.arguments||'{}')}catch{throw Error('Invalid tool arguments.')}result=String(await read(name,args)).slice(0,6000)}catch(e){if(signal?.aborted)throw e;result='Error: '+e.message}messages.push({role:'tool',tool_call_id:call.id,content:result})}
 }
 return 'Research tool budget exhausted; no verified research conclusion.';
}
