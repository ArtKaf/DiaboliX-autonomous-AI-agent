const researchTools=new Set(['list_files','read_file','search_code','parse_ast','code_navigation','module_map','parallel_read','read_task_evidence','project_memory','project_state','index_graph']);
const canonical=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]))):value;
const key=(tool,args)=>JSON.stringify([tool,canonical(args)]);
export function isResearchCall(name,args={},remote){
 if(researchTools.has(name))return true;
 if(name==='run_command'||name==='process_start')return /(?:^|[;&|])\s*(?:ls|find|rg|grep|cat|head|tail|tree|locate|pwd|sed\s+-n)\b/i.test(String(args.command||''));
 if(remote){const original=String(remote.original||'');return original!=='computer'&&(/(?:search|fetch|read[_-]?(?:page|url)|scrape|crawl|browse|web|tavily|brave)/i.test(original)||(remote.annotations?.readOnlyHint===true&&remote.annotations?.openWorldHint===true))}
 return false;
}

// A model-declared reason is not proof that an investigation is necessary.
// The permit binds one concrete research call and cannot be reused unchanged
// until the workspace makes progress.
export function createExecutionPriorityGuard(){
 let pending=null,denials=0;const attempted=new Set();
 return {
  declare({unknown,why_blocking,target_tool,target_args}){
   if(typeof unknown!=='string'||unknown.trim().length<15||typeof why_blocking!=='string'||why_blocking.trim().length<20)throw Error('Describe the specific unknown and why implementation cannot continue without resolving it.');
   if(typeof target_tool!=='string'||!target_tool||!target_args||typeof target_args!=='object'||Array.isArray(target_args))throw Error('Specify one research tool and its exact arguments.');
   const fingerprint=key(target_tool,target_args);if(attempted.has(fingerprint)){denials++;throw Error('This exact investigation was already attempted without a workspace change. Use the existing evidence or change strategy.')}
   if(pending)denials++;pending={fingerprint,target_tool};return {tool:target_tool,notice:'One matching call is permitted. The stated blocker is a model assertion, not verified evidence.'};
  },
  check(name,args,remote){
   if(!isResearchCall(name,args,remote))return {allowed:true};
   const fingerprint=key(name,args);if(pending?.fingerprint===fingerprint){pending=null;attempted.add(fingerprint);denials=0;return {allowed:true,permitted:true}}
   denials++;return {allowed:false,exhausted:denials>=6,message:'Research was ended by the user. Prioritize implementation. If a concrete unknown blocks the next step, call declare_research_blocker with the exact tool and arguments; otherwise continue working or explain the blocker.'};
  },
  progress(){pending=null;attempted.clear();denials=0;},
  exhausted(){return denials>=6}
 };
}
